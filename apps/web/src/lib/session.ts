import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { lookupStaff } from "@sailo/security/roster";
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

/**
 * Where to send somebody the guards have just turned away.
 *
 * Two different people arrive here and they want opposite things. One has no
 * session cookie at all: they typed a private URL while signed out, and the
 * sign-in form is exactly what they came for. The other is holding a cookie
 * that produced no session — a browser that *was* signed in and no longer is,
 * because they signed out on another device, or a password reset revoked every
 * session, or the row simply expired.
 *
 * That second cookie is worthless and nothing else will ever remove it, so it
 * goes through `/api/session/expire` on the way. Without that, the state is
 * permanent: `proxy.ts` reads the cookie's presence to send `/` to `/admin`,
 * this guard bounces `/admin` to the sign-in form, and the visitor cannot
 * reach the landing page again until the cookie's thirty days are up. That is
 * the bug this exists for, and it is why the hop is worth an extra redirect.
 *
 * So the two get different destinations, and only the second pays for a hop.
 */
async function turnedAway(stale: string, signedOut: string): Promise<string> {
  if (!getSessionCookie(await headers())) return signedOut;
  return `/api/session/expire?next=${encodeURIComponent(stale)}`;
}

export async function requireUser() {
  const session = await getSession();
  if (session?.user) return session.user;

  /*
   * A dead cookie goes to the landing page; no cookie goes to `/login`.
   *
   * `proxy.ts` is what put most of the first group here: they asked for `/`,
   * it saw a cookie and forwarded them to `/admin`, and this guard is the
   * first code that actually knows the session is gone. Sending them on to a
   * sign-in form completes a journey nobody asked for — they wanted the home
   * page, and `/` is the one route that serves a signed-out seller and a
   * stranger equally well, with a Sign in link on it either way.
   *
   * The second group navigated to a private URL deliberately while signed
   * out, and for them the form is the point. Unchanged.
   */
  redirect(await turnedAway("/", "/login"));
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
 * Staff, as this app still needs to know about them.
 *
 * The panel itself is apps/hq now and none of its pages are here any more. Two
 * things in this app still ask, and both are real:
 *
 *   - the dispute evidence upload route, which serves staff and sellers through
 *     one endpoint because a 4.5 MB body cannot be a Server Action;
 *   - `/admin`, which shows a couple of staff-only affordances to whoever is
 *     signed in.
 *
 * WHY THIS READS THE DATABASE NOW
 * It used to be `isStaffEmail()` — the `SAILO_STAFF_EMAILS` allowlist. That is
 * no longer where the roster lives: apps/hq writes `staff_members`, and someone
 * invited there would have been staff in the panel and a stranger here. Two
 * answers to "is this person staff" is exactly the drift the split had to
 * avoid, so both apps ask `lookupStaff`, which reads the table and falls back
 * to the environment variable only as break-glass.
 *
 * `emailVerified` is still required. A roster row says the address may enter;
 * it does not prove the session holds that inbox, and sign-up in this app does
 * not check inbox ownership.
 */
/** Where a staff member signs in now — another origin, since the panel moved. */
const HQ_LOGIN = "https://hq.sailo.store/login";

export async function requireStaff() {
  const session = await getSession();
  const user = session?.user;
  /*
   * Both destinations are the staff panel's, not this app's sign-in form: a
   * staff member turned away here belongs at hq.sailo.store, and sending them
   * to the seller login would hand them a password field their account does not
   * have. `turnedAway` still gets the dead-cookie hop through
   * `/api/session/expire`, which is this app's cookie to clear.
   */
  if (!user) redirect(await turnedAway(HQ_LOGIN, HQ_LOGIN));

  const member = await lookupStaff(user.email);
  if (!member || !user.emailVerified) {
    /*
     * A refusal is a 404, which is right for the stranger and useless for us:
     * a colleague locked out by a revoked row sees exactly what an intruder
     * sees, and nothing says why. Naming it in the log turns twenty minutes of
     * confusion into one line, server-side only — the response still gives the
     * caller nothing.
     */
    console.warn(
      `[sailo] staff check refused ${user.email} (verified: ${user.emailVerified})`,
    );
    notFound();
  }
  return { ...user, role: member.role };
}

/**
 * Non-blocking check, for showing staff-only affordances inside /admin.
 * Same test as `requireStaff`, verified email included — an affordance this
 * shows must not lead to a door that check then refuses.
 */
export async function isStaff() {
  const session = await getSession();
  const user = session?.user;
  if (!user?.emailVerified) return false;
  return (await lookupStaff(user.email)) !== null;
}
