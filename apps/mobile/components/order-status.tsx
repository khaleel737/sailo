import { StyleSheet, Text, View } from "react-native";
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
 */

/** The seller-facing words, straight from the dictionary the web admin uses. */
export const ORDER_STATUS_LABELS = adminEn.orderStatus;
export const PAYMENT_STATUS_LABELS = adminEn.paymentStatus;

/** Tone → the two colours a badge is drawn in. Ordinary React Native styles. */
const TONES = {
  blue: { bg: "#eff6ff", fg: "#1d4ed8" },
  amber: { bg: "#fffbeb", fg: "#b45309" },
  green: { bg: "#f0fdf4", fg: "#15803d" },
  red: { bg: "#fef2f2", fg: "#b91c1c" },
  neutral: { bg: "#f3f4f6", fg: "#4b5563" },
} as const;

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
  const tone = TONES[orderStatusTone(status)] ?? TONES.neutral;
  const label = orderStatusLabel(status, ORDER_STATUS_LABELS);
  return (
    <View
      style={[styles.badge, { backgroundColor: tone.bg }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${adminEn.orders.statusLabel}: ${label}`}
    >
      <Text style={[styles.badgeText, { color: tone.fg }]}>{label}</Text>
    </View>
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
const PAYMENT_TONES: Record<string, keyof typeof TONES> = {
  unpaid: "neutral",
  pending: "amber",
  paid: "green",
  refunded: "red",
  disputed: "red",
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const tone = TONES[PAYMENT_TONES[status] ?? "neutral"];
  const label =
    PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] ?? status;
  return (
    <View
      style={[styles.badge, { backgroundColor: tone.bg }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${adminEn.orders.paymentStatusLabel}: ${label}`}
    >
      <Text style={[styles.badgeText, { color: tone.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, fontWeight: "700" },
});
