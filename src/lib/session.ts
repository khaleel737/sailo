import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { isStaffEmail, staffEmails } from "./staff";
import { getDb } from "@/db";
import { shops } from "@/db/schema";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

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
 * Everything behind /hq needs a signed-in user on the staff allowlist.
 *
 * A signed-in stranger gets a 404 rather than a 403: the second tells them the
 * panel exists and that they found the right URL. Someone who isn't signed in
 * at all goes to the login page, because that's an ordinary session expiry and
 * hiding it would just look broken to us.
 */
export async function requireStaff() {
  const session = await getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  if (!isStaffEmail(user.email)) {
    /*
     * A refusal is a 404, which is right for the stranger and useless for us:
     * a founder locked out by a stray SAILO_STAFF_EMAILS override sees exactly
     * what an intruder sees, and nothing says why. Naming the roster in the log
     * turns twenty minutes of confusion into one line. It is server-side only —
     * the response still gives the caller nothing.
     */
    console.warn(
      `[sailo] /hq refused ${user.email}; roster is ${staffEmails().join(", ")}`,
    );
    notFound();
  }
  return user;
}

/** Non-blocking check, for showing staff-only affordances inside /admin. */
export async function isStaff() {
  const session = await getSession();
  return isStaffEmail(session?.user?.email);
}
