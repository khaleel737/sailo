import type Stripe from "stripe";

/**
 * What Stripe Tax actually charged, read off a settled Checkout Session.
 *
 * The counterpart to `normalizeDispute`: one place that turns Stripe's shape
 * into ours, so nothing downstream has to know which of `total_details`,
 * `customer_details` and `amount_total` carries which fact.
 *
 * It exists because under `automatic_tax` the order Sailo wrote at checkout is
 * *deliberately* wrong about tax — it says zero, because at the moment it was
 * written no address had been collected and no rate could be chosen. This is
 * the moment the real numbers exist, and they have to land on the order before
 * `createInvoiceForOrder` reads it, or the invoice states a tax figure that the
 * card statement beside it contradicts.
 *
 * Pure and free of any database access, so the arithmetic below can be tested
 * against recorded session payloads rather than against a live account.
 */

export type SettledTax = {
  /** What the buyer actually paid in tax, in minor units. */
  taxCents: number;
  /** The order total Stripe charged, tax included. */
  totalCents: number;
  /**
   * The rate, back-computed from the amounts.
   *
   * Stripe reports amounts, not a percentage, and it can legitimately be a
   * blend — two line items in different tax categories, or a shipping line
   * taxed at a different rate from the goods. So this is what was charged
   * expressed as a rate, which is exactly what the invoice needs to print and
   * exactly what `orders.taxRateBp` has always meant. Rounded to basis points,
   * which is the column's resolution.
   */
  taxRateBp: number;
  /** The VAT/GST number the buyer supplied, as Stripe validated it. */
  buyerTaxId: string | null;
  /** Stripe's own type string — `eu_vat`, `gb_vat`, `au_abn`. */
  buyerTaxIdType: string | null;
  /**
   * The liability moved to the buyer under the B2B reverse charge.
   *
   * Inferred, because Stripe does not state it as a flag on the session — but
   * inferred from the only combination that means it: the buyer gave a tax
   * number that Stripe accepted, and the tax came to nothing anyway. A consumer
   * sale is zero-tax without a number; a B2B sale inside the seller's own
   * country carries a number *and* tax. Only the pair together is a reverse
   * charge, and only that pair obliges the invoice to say so.
   */
  reverseCharge: boolean;
};

/** Stripe reports a tax-exempt buyer three ways; only one of them is B2B. */
function validTaxId(
  details: Stripe.Checkout.Session.CustomerDetails | null | undefined,
): { value: string; type: string } | null {
  const entry = details?.tax_ids?.find(
    (id) => typeof id.value === "string" && id.value.length > 0,
  );
  return entry?.value ? { value: entry.value, type: entry.type } : null;
}

export function taxFromSession(
  session: Stripe.Checkout.Session,
): SettledTax | null {
  /*
   * `total_details` is absent on a session Stripe did not compute tax for, and
   * null is the honest answer there — it tells the caller to leave the order's
   * own figures alone rather than overwriting a manual-mode order with zeros.
   */
  const totals = session.total_details;
  if (!totals) return null;

  const taxCents = totals.amount_tax ?? 0;
  const totalCents = session.amount_total ?? 0;

  /*
   * The base the rate is measured against: everything the buyer paid that was
   * not itself tax. Guarded against zero because a fully discounted order is a
   * real thing and a division by it is not.
   */
  const net = totalCents - taxCents;
  const taxRateBp = net > 0 ? Math.round((taxCents / net) * 10_000) : 0;

  const taxId = validTaxId(session.customer_details);

  return {
    taxCents,
    totalCents,
    taxRateBp,
    buyerTaxId: taxId?.value ?? null,
    buyerTaxIdType: taxId?.type ?? null,
    reverseCharge: Boolean(taxId) && taxCents === 0,
  };
}
