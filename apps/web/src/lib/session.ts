import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { lookupStaff } from "@sailo/security/roster";
import { getDb } from "@sailo/db";
import { member, shops, type Shop } from "@sailo/db/schema";
import { roleCan, type ShopPermission } from "@sailo/auth/permissions";

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

/**
 * The shop a signed-in person may act in, and whether they may do *this*.
 *
 * ## The argument is required, and it is not defaulted
 *
 * A call site that still compiles because the parameter was optional is a hole
 * that shipped, and it compiles silently across a hundred files. Required, and
 * the compiler enumerates the work: adding this argument produced **113 call
 * sites** across `apps/web` — 63 server actions, 34 pages and layouts, 3 route
 * handlers, and 13 reads inside `src/lib` — and every one of them was read and
 * given the permission that matches what it actually does. That number is what
 * lets the next person check the audit was complete rather than plausible;
 * `session.test.ts` pins it from the source so it cannot drift unnoticed.
 *
 * There is a precedent in this tree for what *enforced* means: every HQ write
 * names a `StaffCapability`, and a bare `requireStaff()` was the hole that
 * shipped once.
 *
 * ## Two questions, deliberately in one function
 *
 * "Which shop is this?" and "may they do this?" were one question while a shop
 * had one person in it. They are two now, and they stay in one call because a
 * caller that could get the shop without asking the second is a caller that
 * will — the reason this is not `requireShop()` plus a separate `can()`.
 *
 * ## The owner is found by `userId`; everybody else by membership
 *
 * `shops.userId` is still the owner of record — spec 03's deletion, the
 * closure record and every existing ownership check read it, and re-pointing
 * all of that at membership would be a second tree-wide change for no gain. So
 * the owner's own shop is found the way it always was, and the membership
 * lookup is what finds a shop somebody was *invited* to.
 *
 * ## Revocation
 *
 * The role is read on **every request** rather than carried in the session, so
 * a removed member's next request is refused whatever their cookie says. The
 * `cache` wrapper makes that one query per request, not one per guard.
 * `removeTeamMember` additionally ends their sessions, so the refusal is
 * immediate on a page they already have open rather than on their next
 * navigation.
 */
export const shopForUser = cache(async (userId: string) => {
  const db = getDb();

  const owned = await db.query.shops.findFirst({
    where: eq(shops.userId, userId),
  });
  if (owned) return { shop: owned, role: "owner" as const };

  /*
   * A shop somebody was invited to. One indexed lookup on
   * `member(user_id, organization_id)` joined to the shop that names the
   * organization — and `member` is the authority, so removing the row is what
   * ends the access.
   */
  const rows = await db
    .select({ shop: shops, role: member.role })
    .from(member)
    .innerJoin(shops, eq(shops.organizationId, member.organizationId))
    .where(eq(member.userId, userId))
    .limit(1);

  const found = rows[0];
  return found ? { shop: found.shop, role: found.role } : null;
});

export type ShopGuard = {
  user: Awaited<ReturnType<typeof requireUser>>;
  shop: Shop;
  /** `owner`, `manager`, `staff` — what they are in *this* shop. */
  role: string;
  /** True when this person is the owner of record (`shops.userId`). */
  isOwner: boolean;
};

export async function requireShop(permission: ShopPermission): Promise<ShopGuard> {
  const user = await requireUser();
  const found = await shopForUser(user.id);
  if (!found) redirect("/onboarding");

  if (!roleCan(found.role, permission)) {
    /*
     * A refusal, not a blank screen — spec 37's browser test is exactly this.
     * `/admin/no-access` names the permission and says who to ask.
     *
     * A redirect rather than `forbidden()`, which is the obvious answer and is
     * the wrong one here. `forbidden()` needs `experimental.authInterrupts`,
     * and — more decisively — it renders a page for a *navigation* while two
     * thirds of this function's callers are Server Actions, where a thrown
     * interrupt surfaces as an error rather than as a refusal anybody can read.
     * `redirect` behaves the same way in both, which is what makes one guard
     * enough. It is also what this function already does when there is no shop
     * at all.
     *
     * The permission travels in the query string so the page can name it.
     * Nothing is disclosed: the person is signed in, is a member of this shop,
     * and is being told what they asked to do.
     *
     * Logged server-side as well, because a colleague locked out by a role
     * change and an intruder see the same page, and nothing else says which
     * this was.
     */
    console.warn(
      `[sailo] ${user.email} (${found.role}) refused ${permission} in shop ${found.shop.id}`,
    );
    redirect(`/admin/no-access?need=${encodeURIComponent(permission)}`);
  }

  return {
    user,
    shop: found.shop,
    role: found.role,
    isOwner: found.shop.userId === user.id,
  };
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

  const staff = await lookupStaff(user.email);
  if (!staff || !user.emailVerified) {
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
  return { ...user, role: staff.role };
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
