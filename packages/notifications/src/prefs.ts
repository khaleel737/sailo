import { z } from "zod";
import type { NotificationPrefs } from "@sailo/db/schema/json-types";

/**
 * The seller-facing email switches, and the rule that makes them safe to
 * extend: absence of a key means ON. `{}` is "everything", so a new event
 * type ships enabled for every existing shop without a backfill — and a
 * pref written by a newer build never turns anything off in an older one.
 *
 * This lived in `apps/web/src/lib/notification-prefs.ts` until the settings
 * screen on the phone needed the same switches. `packages/api` cannot reach
 * into `apps/web`, and a second schema written for it would be a second
 * opinion about which keys are legal — which is the one thing `strictObject`
 * below exists to prevent. Web still imports `@/lib/notification-prefs`; that
 * file is now a re-export.
 */

/**
 * `strictObject`, not `object`: jsonb hands back whatever was written,
 * including by a build that no longer exists, and this column feeds a
 * decision about whether to email someone. Unknown keys are rejected on the
 * way in rather than stored and silently ignored forever.
 */
export const notificationPrefsSchema = z.strictObject({
  orderPlaced: z.boolean().optional(),
  bookingRequested: z.boolean().optional(),
  orderNeedsAction: z.boolean().optional(),
  membershipStarted: z.boolean().optional(),
  membershipCancelled: z.boolean().optional(),
  membershipPaymentFailed: z.boolean().optional(),
  taxThreshold: z.boolean().optional(),
  leadCaptured: z.boolean().optional(),
  lowStock: z.boolean().optional(),
});

/** The event types a seller can be emailed about today. */
export type NotificationEvent = keyof NotificationPrefs;

/**
 * The same list at runtime, for the settings form to iterate. Typed against
 * the schema's own keys, so adding an event to the schema and forgetting it
 * here is a compile error rather than a switch nobody can find.
 */
export const NOTIFICATION_EVENTS = [
  "orderPlaced",
  "bookingRequested",
  "orderNeedsAction",
  /*
   * The membership three, which had no switches because they had no mail.
   *
   * Sailo has run recurring billing for as long as it has run orders and never
   * told a seller anything about it: a member could join, cancel, or fail a
   * renewal and the only trace was a row changing colour in a list nobody has
   * open. `membershipPaymentFailed` is the one that cost money — Stripe retries
   * a failed card for a few days and then cancels, so a seller who found out
   * afterwards had lost the member without a chance to send the message that
   * would have kept them.
   *
   * On by default like the rest, because absence of a key means on and these
   * ship to shops that never asked for them. A shop with no memberships gets
   * nothing regardless — there is no event to fire.
   */
  "membershipStarted",
  "membershipCancelled",
  "membershipPaymentFailed",
  /*
   * The threshold warning, which is the one mail on this list a seller cannot
   * get from anywhere else. Everything above reports something they can also
   * see by opening the admin; this one is about a number nobody watches until
   * it has already been crossed.
   */
  "taxThreshold",
  /*
   * Running out — spec 51, and the other mail on this list a seller cannot get
   * from anywhere else.
   *
   * `lowStock` matched zero files in this tree, so the way a seller found out
   * they were out of stock was a buyer telling them. Everything above except
   * the threshold warning reports something they could also see by opening the
   * admin; nobody opens the admin to check a number that was fine yesterday.
   *
   * Free on every plan, and deliberately: it prevents a loss rather than
   * creating a sale, and gating it would price the smallest shops out of
   * knowing their own stockroom.
   */
  "lowStock",
  /*
   * A lead arriving on a zero-priced enquiry product — spec 07.
   *
   * It was in the schema and in `json-types.ts` and had a real sender in
   * `packages/workflows/src/leads/notify-seller.ts`, and it was missing from
   * this array. Absence here does not mean the mail stops: `wantsNotification`
   * reads absence as *on*, so it sent, and the seller had no switch to stop it.
   */
  "leadCaptured",
] as const satisfies readonly NotificationEvent[];

/**
 * Whether the shop still wants this event. Reads the column defensively —
 * jsonb is only as trustworthy as every build that ever wrote it — so
 * anything but a literal `false` means send.
 */
export function wantsNotification(
  prefs: unknown,
  event: NotificationEvent,
): boolean {
  if (typeof prefs !== "object" || prefs === null) return true;
  return (prefs as Record<string, unknown>)[event] !== false;
}
