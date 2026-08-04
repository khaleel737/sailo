import type { Coupon, DeliveryMethod, ProductOption, VariantOptions } from "@/db/schema";
import { computeTotals, type TaxSettings, type Totals } from "@/lib/pricing";
import { needsDelivery as kindNeedsDelivery, variantLabel } from "@/lib/variants";

/**
 * What an order costs, and what it needs to ask the buyer for.
 *
 * All of it is pure. The server action reads rows and writes them; every
 * decision in between — which lines are deliverable, what a coupon takes off,
 * what an affiliate earns — happens here, where it can be exercised directly
 * for one product or for a cart of them.
 */

/** A line, priced and resolved server-side. Never trust the browser's numbers. */
export type QuoteLine = {
  productId: string;
  variantId: string | null;
  title: string;
  /** physical | digital | service */
  kind: string;
  options: ProductOption[];
  variantOptions: VariantOptions | null;
  sku: string | null;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
};

export type QuoteInput = {
  lines: QuoteLine[];
  coupon?: Coupon | null;
  deliveryMethod?: Pick<DeliveryMethod, "feeCents" | "freeOverCents"> | null;
  commissionBp?: number | null;
  tax?: TaxSettings | null;
  /** Shop-level switch for asking after a delivery address. */
  collectAddress?: boolean;
  /** collection orders have nowhere to deliver to. */
  deliveryType?: string | null;
  now?: Date;
};

export type Quote = {
  totals: Totals;
  /** Every line with its own money worked out. */
  lines: (QuoteLine & { subtotalCents: number; label: string })[];
  /** True when anything in the order has to physically reach the buyer. */
  needsDelivery: boolean;
  needsAddress: boolean;
  /** True when at least one line is a service, or a file. */
  hasService: boolean;
  hasDigital: boolean;
  unitCount: number;
};

export function lineSubtotal(line: Pick<QuoteLine, "unitPriceCents" | "quantity">) {
  return Math.max(0, line.unitPriceCents) * Math.max(0, line.quantity);
}

export function cartSubtotal(lines: Pick<QuoteLine, "unitPriceCents" | "quantity">[]) {
  return lines.reduce((sum, line) => sum + lineSubtotal(line), 0);
}

/**
 * A cart of downloads and appointments has nothing to ship. One physical item
 * in it does, and the fee is charged once for the order rather than per line.
 */
export function cartNeedsDelivery(lines: Pick<QuoteLine, "kind">[]) {
  return lines.some((line) => kindNeedsDelivery(line.kind));
}

export function quote(input: QuoteInput): Quote {
  const lines = input.lines.map((line) => ({
    ...line,
    subtotalCents: lineSubtotal(line),
    label: line.variantOptions
      ? variantLabel(line.variantOptions, line.options)
      : "",
  }));

  const needsDelivery = cartNeedsDelivery(lines);

  const totals = computeTotals({
    subtotalCents: cartSubtotal(lines),
    // A discount is on the goods, so it applies whatever they are: a coupon
    // works the same on a mug, a PDF and a workshop.
    coupon: input.coupon,
    // Nothing to deliver means no fee, even if the buyer picked a rate.
    deliveryMethod: needsDelivery ? input.deliveryMethod : null,
    commissionBp: input.commissionBp,
    tax: input.tax,
    now: input.now,
  });

  return {
    totals,
    lines,
    needsDelivery,
    needsAddress:
      needsDelivery &&
      Boolean(input.collectAddress) &&
      input.deliveryType !== "collection",
    hasService: lines.some((l) => l.kind === "service"),
    hasDigital: lines.some((l) => l.kind === "digital"),
    unitCount: lines.reduce((sum, l) => sum + Math.max(0, l.quantity), 0),
  };
}

/** A one-line summary for a chat message or an order list: "Mug and 2 more". */
export function summarise(
  lines: { title: string; label?: string }[],
  more = (n: number) => `and ${n} more`,
) {
  if (lines.length === 0) return "";
  const [first, ...rest] = lines;
  const head = first.label ? `${first.title} — ${first.label}` : first.title;
  return rest.length ? `${head} ${more(rest.length)}` : head;
}
