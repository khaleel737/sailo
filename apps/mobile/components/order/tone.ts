import { orderStatusTone } from "@sailo/core/order-status";
import type { StatusTone } from "@sailo/design-system/native";
import type { useT } from "../../lib/i18n";

/**
 * What colour a status is, and what to call a payment state.
 *
 * WHY THIS IS NOT IN A SCREEN
 *
 * `orderTone` was exported from `app/(tabs)/orders/index.tsx` — a *route*. Three screens
 * imported it from there: the orders list itself, the order detail, and a customer's order
 * history. In Expo Router every file under `app/` is a route, so importing that helper meant
 * pulling a screen module in to ask what colour a badge should be.
 *
 * A shared helper cannot live under `app/`. It lives here, and the three screens import a
 * component module instead of each other.
 */

/**
 * An order's status, in the vocabulary a badge speaks.
 *
 * `orderStatusTone` in `@sailo/core` answers in colour names, because the web's palette
 * speaks those; `StatusPill` takes a semantic role. This is the translation between the two,
 * and it lives on this side of the boundary because a design system that knew what
 * "refunded" meant would have a domain inside it — which is the reason `status-pill.tsx`
 * says the mapping is the caller's.
 */
const PILL_TONES: Record<ReturnType<typeof orderStatusTone>, StatusTone> = {
  blue: "info",
  amber: "warning",
  green: "success",
  red: "danger",
  neutral: "neutral",
};

export function orderTone(status: string): StatusTone {
  return PILL_TONES[orderStatusTone(status)];
}

/**
 * What the buyer has actually paid, as a tone.
 *
 * Separate from `orderTone`, because payment states are not order states: a refund is a
 * *neutral* fact about an order and a red one about a payment. `disputed` is the bank's
 * decision, not the seller's, which is why it is the same red as a refund rather than a
 * warning.
 */
const PAYMENT_TONES: Record<string, StatusTone> = {
  unpaid: "neutral",
  pending: "warning",
  paid: "success",
  refunded: "danger",
  disputed: "danger",
};

/** A payment status as a tone, defaulting to neutral for one we do not know. */
export function paymentTone(status: string): StatusTone {
  return PAYMENT_TONES[status] ?? "neutral";
}

/**
 * A payment status, in the seller's language.
 *
 * Falls back to the stored value rather than an em dash. The column is text, so a row written
 * by a build that knew a status this one does not would otherwise render as blank — and "no
 * payment status" is a different and more alarming thing to read than a word you do not
 * recognise.
 */
export function paymentLabel(status: string, a: ReturnType<typeof useT>["a"]): string {
  /* Indexed through a widened view rather than a `keyof` cast: the column is text, so the
     value genuinely may not be a key, and a cast that claims it is would hand back
     `undefined` typed as `string`. */
  const labels: Record<string, string | undefined> = a.paymentStatus;
  return labels[status] ?? status;
}
