import type { Coupon, DeliveryMethod, ProductOption, VariantOptions } from "@sailo/db/schema";
import { computeTotals, type TaxSettings, type Totals } from "./pricing";
import { basketWeightGrams } from "./weight";
import { needsDelivery as kindNeedsDelivery, variantLabel } from "../catalog/variants";

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
  /**
   * What one of these weighs, in grams — spec 51.
   *
   * Optional because the type is constructed by hand in a dozen tests and two
   * projections, and absent means the same as null: nobody has weighed it. Set
   * once, in `resolveLines`, from the variant's weight falling back to the
   * product's — so `previewOrder` and `createOrderIntent` inherit the same
   * number rather than each computing one, which is how a delivery fee comes to
   * differ between the basket and the charge.
   */
  weightGrams?: number | null;
  /**
   * Which price band this line bought, and which date — spec 50.
   *
   * Optional for the same reason `weightGrams` is: the type is built by hand in
   * a dozen tests and two projections, and absent means the same as null. Set
   * once, in `resolveLines`, from the rows the buyer's choice names — so the
   * basket, the order line, the ticket and the seat that is claimed against the
   * tier are all the same three values rather than four derivations of them.
   *
   * `tierName` travels beside the id and is not a convenience. It is what gets
   * written onto `tickets.tier`, which the door list prints: a band renamed or
   * deleted between the on-sale and the night must not change what appears
   * beside somebody's name, so the name is snapshotted at the moment of sale.
   */
  tierId?: string | null;
  sessionId?: string | null;
  tierName?: string | null;
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
  /**
   * True when something here can only reach the buyer through an inbox — a
   * download link or a ticket. Both are handed over on the confirmation
   * screen too, and that screen is one closed tab away from being gone, so
   * an order carrying either has to have somewhere to send it again.
   */
  needsEmail: boolean;
  unitCount: number;
};

/** The kinds that arrive by email as well as on screen. */
export function cartNeedsEmail(lines: Pick<QuoteLine, "kind">[]) {
  return lines.some(
    (line) =>
      line.kind === "digital" ||
      line.kind === "event" ||
      /*
       * A membership needs an inbox more than either of them.
       *
       * It is the only kind that keeps charging the card after the buyer has
       * closed the tab, so the receipt for month four, the warning that a card
       * failed, and the link that stops the whole thing all have to land
       * somewhere. A membership bought without an address is one the buyer can
       * only cancel through their bank.
       */
      line.kind === "membership",
  );
}

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
    /*
     * The combination the buyer picked, and on an event that is the band.
     *
     * A tier is deliberately not a variant — see the note on `event_tiers` —
     * so it has no `variantOptions` to render, and without this an order for
     * "VIP" reached the drawer, the order line, Stripe's page and the seller's
     * inbox as a bare product title. Three of those four are what a buyer
     * checks the price against.
     */
    label: line.variantOptions
      ? variantLabel(line.variantOptions, line.options)
      : (line.tierName ?? ""),
  }));

  const needsDelivery = cartNeedsDelivery(lines);

  const totals = computeTotals({
    subtotalCents: cartSubtotal(lines),
    /*
     * What the parcel weighs, for a rate priced by weight — spec 51.
     *
     * Summed here rather than at each caller, and that is the point: both
     * pricing sinks are built on `quote`, so the weight the basket is quoted
     * against and the weight the order is charged against are the same
     * addition. Zero for every basket of downloads and appointments, and
     * ignored outright by a `flat` rate.
     */
    weightGrams: basketWeightGrams(lines),
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
    needsEmail: cartNeedsEmail(lines),
    unitCount: lines.reduce((sum, l) => sum + Math.max(0, l.quantity), 0),
  };
}

/** A one-line summary for a chat message or an order list: "Mug and 2 more". */
export function summarise(
  lines: { title: string; label?: string }[],
  more = (n: number) => `and ${n} more`,
) {
  const [first, ...rest] = lines;
  // Nothing to summarise. Checked via the destructured head rather than
  // `lines.length`, which the compiler can't connect to `first` being present.
  if (!first) return "";
  const head = first.label ? `${first.title} — ${first.label}` : first.title;
  return rest.length ? `${head} ${more(rest.length)}` : head;
}
