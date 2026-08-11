import { z } from "zod";
import type { NotificationPrefs } from "@sailo/db/schema/json-types";

/**
 * The seller-facing email switches, and the rule that makes them safe to
 * extend: absence of a key means ON. `{}` is "everything", so a new event
 * type ships enabled for every existing shop without a backfill — and a
 * pref written by a newer build never turns anything off in an older one.
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
