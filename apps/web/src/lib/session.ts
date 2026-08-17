import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { isStaffEmail, staffEmails } from "@sailo/security/staff";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";

/**
 * Wrapped in React's `cache` so one request pays for one session lookup, no
 * matter how many guards ask. The /hq queries each call `requireStaff` for
 * themselves — the layout's check doesn't cover them, because Next renders
 * layout and page in parallel — and without this, a page assembling five
 * queries would make five identical round trips.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  return session.user;
}

/** Everything behind /admin needs both a user and the shop they own. */
export async function requireShop() {
  const user = await requireUser();
  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.userId, user.id),
  });
  if (!shop) redirect("/onboarding");
  return { user, shop };
}

/**
 * Everything behind /hq needs a signed-in user on the staff allowlist, with
 * the email verified — proven by clicking a link sent to it, which is also
 * how /hq/login signs staff in. Without the verified requirement, typing a
 * staff address into the ordinary sign-up form would be enough: sign-up
 * doesn't check inbox ownership, and an allowlist of emails is only as good
 * as the proof that the session's email is really its holder's.
 *
 * A signed-in stranger gets a 404 rather than a 403: the second tells them the
 * panel exists and that they found the right URL. Someone who isn't signed in
 * at all goes to the staff login, because that's an ordinary session expiry
 * and hiding it would just look broken to us.
 */
export async function requireStaff() {
  const session = await getSession();
  const user = session?.user;
  if (!user) redirect("/hq/login");

  if (!isStaffEmail(user.email) || !user.emailVerified) {
    /*
     * A refusal is a 404, which is right for the stranger and useless for us:
     * a founder locked out by a stray SAILO_STAFF_EMAILS override sees exactly
     * what an intruder sees, and nothing says why. Naming the roster in the log
     * turns twenty minutes of confusion into one line. It is server-side only —
     * the response still gives the caller nothing.
     */
    console.warn(
      `[sailo] /hq refused ${user.email} (verified: ${user.emailVerified}); ` +
        `roster is ${staffEmails().join(", ")}`,
    );
    notFound();
  }
  return user;
}

/**
 * Non-blocking check, for showing staff-only affordances inside /admin.
 * Same test as `requireStaff`, verified email included — an affordance this
 * shows must not lead to a door that check then refuses.
 */
export async function isStaff() {
  const session = await getSession();
  const user = session?.user;
  return Boolean(user?.emailVerified) && isStaffEmail(user?.email);
}
