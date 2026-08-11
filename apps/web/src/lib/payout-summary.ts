/**
 * The shapes the payout card renders, and the arithmetic that builds them —
 * pure, so the currency grouping is testable without Stripe.
 *
 * Everything here is JSON-safe by construction: the whole overview is cached
 * in Redis as a string and must survive the round trip unchanged. Dates are
 * epoch seconds (as Stripe hands them over), money is minor units.
 */

export type BalanceRow = {
  /** Uppercased ISO code, as the rest of the app writes currencies. */
  currency: string;
  availableCents: number;
  pendingCents: number;
};

export type PayoutRow = {
  id: string;
  amountCents: number;
  currency: string;
  /** Stripe's own vocabulary: paid | pending | in_transit | canceled | failed. */
  status: string;
  /** Epoch seconds. */
  created: number;
  arrivalDate: number | null;
};

export type PayoutOverview = {
  balances: BalanceRow[];
  payouts: PayoutRow[];
  payoutsEnabled: boolean;
  /** Stripe's `requirements.currently_due` field names, verbatim. */
  requirementsDue: string[];
};

type StripeAmount = { amount: number; currency: string };

/**
 * Available and pending folded into one row per currency.
 *
 * Balances arrive as two parallel per-currency lists, and they need not name
 * the same currencies — a UK shop refunded in EUR once has a EUR row on one
 * side only. Every currency named on either side gets a row; nothing is ever
 * summed across currencies, because there is no rate to sum at.
 */
export function groupBalances(
  available: StripeAmount[],
  pending: StripeAmount[],
): BalanceRow[] {
  const rows = new Map<string, BalanceRow>();

  const row = (currency: string): BalanceRow => {
    const code = currency.toUpperCase();
    let entry = rows.get(code);
    if (!entry) {
      entry = { currency: code, availableCents: 0, pendingCents: 0 };
      rows.set(code, entry);
    }
    return entry;
  };

  // += rather than =: Stripe may split one currency across source types.
  for (const a of available) row(a.currency).availableCents += a.amount;
  for (const p of pending) row(p.currency).pendingCents += p.amount;

  // Largest balance first, so the currency the seller actually trades in
  // leads; ties (all-zero rows) fall back to the code for a stable order.
  return [...rows.values()].toSorted(
    (a, b) =>
      b.availableCents + b.pendingCents - (a.availableCents + a.pendingCents) ||
      a.currency.localeCompare(b.currency),
  );
}
