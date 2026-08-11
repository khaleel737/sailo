import { formatPercent } from "@/lib/pricing";

/**
 * What to call the tax line.
 *
 * The same fallback was written out in five places, three of them hardcoding
 * the English word while the invoice page used the translated one — so a
 * German shop's invoice page said "MwSt." and its PDF said "Tax". The word is
 * a parameter here so a caller with a dictionary can pass theirs and a caller
 * without one still gets something sensible.
 */

export function taxName(
  order: { taxName: string | null },
  fallback = "Tax",
): string {
  // A seller who named their tax wins over any default: "VAT", "GST", "IVA"
  // are the shop's own word for it.
  return order.taxName?.trim() || fallback;
}

/** The name with its rate, for a line that shows both. */
export function taxLabel(
  order: { taxName: string | null; taxRateBp: number },
  fallback = "Tax",
): string {
  const name = taxName(order, fallback);
  // A zero rate still gets a name — the line exists because tax was charged
  // at some point — but "(0%)" beside it reads as a mistake.
  return order.taxRateBp > 0
    ? `${name} (${formatPercent(order.taxRateBp)}%)`
    : name;
}
