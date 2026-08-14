import { StatusPill } from "@sailo/design-native";
import type { StatusTone } from "@sailo/design-native";
import { orderStatusLabel, orderStatusTone } from "@sailo/core/order-status";
import { adminEn } from "@sailo/i18n/admin/en";

/**
 * How an order's status and payment state look on the phone.
 *
 * Three facts are imported, not restated. `orderStatusTone` decides which
 * statuses carry warm colour, `orderStatusLabel` turns a stored value into a
 * written one, and `adminEn` supplies the words themselves — the same
 * dictionary the web dashboard's status dropdown reads. A seller who confirms
 * an order on their laptop and opens the app sees the identical word, because
 * there is only one place that word is written down.
 *
 * English only, which is what the rest of this app already is: there is no
 * locale plumbing on mobile yet, so `adminEn` is imported directly rather than
 * resolved per-locale. Wiring the seller's language through is app-wide work,
 * and when it lands this is the only file that has to learn about it.
 *
 * WHAT CHANGED: THE BADGE IS NOW THE ONE BADGE
 *
 * These two drew themselves — a local `StyleSheet` and a five-row table of hex
 * pairs lifted from a framework's default palette (`#eff6ff`/`#1d4ed8`,
 * `#f0fdf4`/`#15803d`, …). None of those colours is Sailo's, none of them has a
 * dark variant, and there was already a `StatusPill` in the design system doing
 * the same job in the same shape. So on the order detail screen, in dark mode,
 * two near-white pills sat on a near-black page — and the *same* status
 * rendered in two different greens depending on which screen you were on.
 *
 * What is left here is the only part that is genuinely this app's: the mapping
 * from a stored status string to a tone, and the accessibility label that says
 * which of the two questions a bare adjective is answering.
 */

/** The seller-facing words, straight from the dictionary the web admin uses. */
export const ORDER_STATUS_LABELS = adminEn.orderStatus;
export const PAYMENT_STATUS_LABELS = adminEn.paymentStatus;

/**
 * `@sailo/core`'s tone vocabulary, in the design system's.
 *
 * The two lists exist for different reasons and are deliberately not merged:
 * core names a *colour family* because the web's Tailwind classes are written
 * in those terms, and the design system names a *meaning* because a phone has
 * one palette and a screen must not pick a hex. This table is the seam, and it
 * is four lines rather than a shared enum because making core depend on a React
 * Native package to spell "warning" would put a phone dependency on the API
 * server, which imports core.
 */
const TONES: Record<string, StatusTone> = {
  blue: "info",
  amber: "warning",
  green: "success",
  red: "danger",
  neutral: "neutral",
};

/**
 * WHY THESE BADGES SAY WHAT THEY ARE, NOT JUST WHAT THEY SAY
 *
 * Tone is decoration and never the carrier: the word is always drawn, so a
 * seller who cannot separate the amber pill from the green one still reads
 * "Pending" and "Confirmed". That much the markup already got right.
 *
 * What it did not carry is *which question* the word answers. The detail
 * screen puts an order badge and a payment badge side by side, and VoiceOver
 * reads them as two bare adjectives — "Confirmed, Paid" — with nothing saying
 * which is which. The label supplies the missing half. It is the same
 * dictionary the visible word comes from, so the two cannot drift.
 */
export function OrderStatusBadge({ status }: { status: string }) {
  const label = orderStatusLabel(status, ORDER_STATUS_LABELS);
  return (
    <StatusPill
      label={label}
      tone={TONES[orderStatusTone(status)] ?? "neutral"}
      accessibilityLabel={`${adminEn.orders.statusLabel}: ${label}`}
      testID="order-status-badge"
    />
  );
}

/**
 * What the buyer has actually paid, as a badge that cannot be tapped.
 *
 * Read-only on purpose, and the constraint is deliberate rather than unfinished:
 * `PAYMENT_STATUSES` is declared in apps/web and nothing outside it sets a
 * payment status — there is a test in apps/web asserting exactly that. Money
 * that has moved is not something a phone should be able to rewrite, so this
 * renders the state and offers no way to change it.
 *
 * The tone mapping is local because payment states are not order states: a
 * refund is a *neutral* fact about an order and a red one about a payment.
 */
const PAYMENT_TONES: Record<string, StatusTone> = {
  unpaid: "neutral",
  pending: "warning",
  paid: "success",
  refunded: "danger",
  disputed: "danger",
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const label =
    PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] ?? status;
  return (
    <StatusPill
      label={label}
      tone={PAYMENT_TONES[status] ?? "neutral"}
      accessibilityLabel={`${adminEn.orders.paymentStatusLabel}: ${label}`}
      testID="payment-status-badge"
    />
  );
}
