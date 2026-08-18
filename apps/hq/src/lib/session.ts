import { cache } from "react";
import { headers } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { getAuth } from "./auth";
import { can, type StaffCapability, type StaffRole } from "@sailo/security/staff";
import { lookupStaff, touchStaffSeen } from "@sailo/security/roster";

/**
 * Who is asking, and what they are allowed to do.
 *
 * Wrapped in React's `cache` so one request pays for one session lookup and one
 * roster lookup, no matter how many guards ask. That repetition is not
 * hypothetical: every query in `lib/queries` calls `requireStaff()` for itself,
 * because Next renders a layout and its page in parallel and a layout's refusal
 * is therefore not proof the page's reads never ran. A page assembling five
 * queries would otherwise make five identical round trips — ten, now that each
 * one also resolves a role.
 */

export type Staff = {
  /** Better-auth's user id. */
  id: string;
  /** Lowercased, and the identity the roster is keyed on. */
  email: string;
  role: StaffRole;
};

const resolve = cache(async (): Promise<Staff | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const user = session?.user;
  if (!user) return null;

  /*
   * The roster is consulted on every request rather than trusted from the
   * session, and that is the price of the promise `revokeStaff` makes.
   *
   * A role baked into the session at sign-in would be a seven-day-old opinion:
   * demoting someone from admin to support, or revoking them outright, would
   * not take effect until their cookie expired. Since the whole reason to build
   * a roster was the person you no longer trust, an access check that lags by a
   * week is not one.
   *
   * `emailVerified` is not tested here, unlike the old env-based guard in
   * apps/web. It cannot be false: the only way to hold a session on this app is
   * to have clicked a link mailed to the address, and better-auth sets the flag
   * as it creates the account. There is no other sign-up path on this origin to
   * arrive by.
   */
  const member = await lookupStaff(user.email);
  if (!member) return null;

  /*
   * Deliberately not awaited. A failed write here must never be able to refuse
   * a staff member entry — the worst case is a stale timestamp on a screen
   * nobody is looking at. The write is throttled in SQL, so this is a no-op on
   * all but one request in fifteen minutes.
   */
  void touchStaffSeen(member.email).catch(() => {});

  return { id: user.id, email: member.email, role: member.role };
});

/** Non-blocking. For deciding whether to render an affordance at all. */
export async function getStaff(): Promise<Staff | null> {
  return resolve();
}

/**
 * May whoever is asking do this — as a boolean, without refusing anything.
 *
 * The rendering half of `requireStaff(capability)`, and deliberately the
 * *second* half. A button hidden from a support member is a courtesy: it stops
 * them clicking something that was going to 403 and wondering whether the panel
 * is broken. It is not the control. The control is the check inside the action,
 * which is a public HTTP endpoint with a generated name that anybody who has
 * ever loaded the page's JavaScript can call from anywhere.
 *
 * So the rule for using this is: never on its own. Every place this hides an
 * affordance, the thing behind the affordance asks the same question again and
 * means it. If a screen ever gates something with this and nothing else, the
 * gate is decoration.
 *
 * Request-cached through `resolve`, so asking it eight times in one page costs
 * one session lookup — which is what lets a page ask per button rather than
 * threading a role through every component.
 */
export async function staffCan(capability: StaffCapability): Promise<boolean> {
  const staff = await resolve();
  return staff ? can(staff.role, capability) : false;
}

/**
 * The raw session, with no roster check on it.
 *
 * Exactly one caller: `/login`, which needs to know whether to bounce an
 * already-signed-in visitor into the panel. It cannot use `getStaff()` for that
 * — that answers null both for "not signed in" and for "signed in but revoked",
 * and a revoked member sent back to a login page they just used would loop.
 *
 * Nothing else should reach for this. Being signed in is not being staff, and
 * the two questions have different answers on this app by design.
 */
export async function getSession() {
  return getAuth().api.getSession({ headers: await headers() });
}

/**
 * The guard on every page and every query in this app.
 *
 * A signed-in stranger gets a 404 rather than a 403: the second tells them the
 * panel exists and that they found the right URL. Someone who is not signed in
 * at all goes to the sign-in page, because that is an ordinary session expiry
 * and hiding it would just look broken to us.
 *
 * Pass a capability to require one:
 *
 *     const staff = await requireStaff();                  // any active member
 *     const staff = await requireStaff("money:move");      // and may refund
 *
 * The capability form answers 403 rather than 404, and the difference is
 * deliberate. A 404 is cover against someone who should not know this panel
 * exists; a support member who has already signed in knows perfectly well that
 * it exists, and telling them "you can't do that" is honest where pretending
 * the page is missing would just send them to us confused.
 */
export async function requireStaff(capability?: StaffCapability): Promise<Staff> {
  const staff = await resolve();

  if (!staff) {
    const session = await getAuth().api.getSession({ headers: await headers() });
    if (!session?.user) redirect("/login");
    /*
     * Signed in, but not on the roster — or revoked. Logged server-side
     * because the two cases that reach here are an intruder and a colleague
     * whose access someone ended an hour ago, and only one of them will think
     * to tell us. The response gives the caller nothing either way.
     */
    console.warn(`[sailo] hq refused ${session.user.email}`);
    notFound();
  }

  if (capability && !can(staff.role, capability)) {
    console.warn(
      `[sailo] hq refused ${staff.email} (${staff.role}) for ${capability}`,
    );
    forbidden();
  }

  return staff;
}
