import type { Order, OrderItem } from "@sailo/db/schema";

/**
 * What an order contains, as anything that renders one needs to say it.
 *
 * An order stores what was bought twice: `orderItems` rows, and a set of
 * single-item columns on the order itself (`productTitle`, `unitPriceCents`,
 * `quantity`) kept so a one-line order can be listed without a join. Two
 * representations of one fact is a standing invitation to read the wrong one,
 * and every consumer that reached for the header directly went on to get a
 * multi-line order wrong:
 *
 *   - Stripe was sent one line and charged $120.16 for a $182.16 basket.
 *   - The confirmation email and the invoice both computed a line subtotal as
 *     `unitPriceCents x quantity` — but `quantity` counts *every unit in the
 *     order*, so for two lines that multiplies the first product's price by the
 *     whole basket's unit count. $31 + $90 came out as $62.
 *
 * WHY THE READ IS NEXT DOOR AND NOT HERE
 *
 * This module holds the half with no connection in it: the shape of a line, how
 * to build one from rows or from the header, how to title one, and how to
 * summarise an order in a sentence. Fetching the rows is
 * `@sailo/commerce/orders`.
 *
 * That split is not tidiness. `@sailo/email` and `@sailo/notifications` render
 * an order they were *handed* and need only what is below; `@sailo/commerce`
 * both reads orders and calls those two to tell people about them. While all of
 * it lived in one module the dependency ran both ways and turbo refused the
 * graph — a receipt that needs a database connection in order to name itself is
 * a receipt that can only be composed next to the database.
 */

export type OrderLine = {
  /** Stable within the order, so a list can key on it. */
  id: string;
  orderId: string;
  position: number;
  productId: string | null;
  variantId: string | null;
  title: string;
  variantLabel: string | null;
  sku: string | null;
  kind: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
  scheduledFor: Date | null;
  serviceMode: string | null;
  serviceLocation: string | null;
};

function fromItem(item: OrderItem): OrderLine {
  return {
    id: item.id,
    orderId: item.orderId,
    position: item.position,
    productId: item.productId,
    variantId: item.variantId,
    title: item.title,
    variantLabel: item.variantLabel,
    sku: item.sku,
    kind: item.kind,
    imageUrl: item.imageUrl,
    unitPriceCents: item.unitPriceCents,
    quantity: item.quantity,
    subtotalCents: item.subtotalCents,
    scheduledFor: item.scheduledFor,
    serviceMode: item.serviceMode,
    serviceLocation: item.serviceLocation,
  };
}

/**
 * The single line described by an order's header columns.
 *
 * Only ever correct when the order genuinely has one line, which is why the
 * subtotal is taken from `order.subtotalCents` rather than recomputed: for one
 * line the two agree, and taking the stored figure means this can't invent a
 * number even if the header is inconsistent.
 */
function fromHeader(order: Order): OrderLine {
  return {
    id: `${order.id}-1`,
    orderId: order.id,
    position: 0,
    productId: order.productId,
    variantId: order.variantId,
    title: order.productTitle,
    variantLabel: order.variantLabel,
    sku: order.variantSku,
    kind: order.productKind,
    imageUrl: null,
    unitPriceCents: order.unitPriceCents,
    quantity: order.quantity,
    subtotalCents: order.subtotalCents,
    scheduledFor: order.scheduledFor,
    serviceMode: order.serviceMode,
    serviceLocation: order.serviceLocation,
  };
}

/**
 * Falls back to the header only when the order really is one line.
 *
 * A multi-line order with no rows is corruption, not a legacy shape. Returning
 * a plausible single line there is how the money bugs happened, so this logs it
 * loudly and returns nothing rather than something wrong. Callers that price
 * from lines then fail visibly instead of undercharging.
 */
export function linesFor(order: Order, items: OrderItem[]): OrderLine[] {
  if (items.length > 0) return items.map(fromItem);
  if (order.itemCount <= 1) return [fromHeader(order)];

  console.error(
    `[sailo] order ${order.id} claims ${order.itemCount} lines but has no ` +
      `order_items rows; refusing to synthesise one from the header`,
  );
  return [];
}

/**
 * What the lines add up to.
 *
 * Anything that hands an amount to a payment provider compares against this
 * and refuses to proceed on a mismatch — a total that disagrees with its own
 * lines means someone is about to be charged the wrong money.
 */
export function linesSubtotal(lines: Pick<OrderLine, "subtotalCents">[]) {
  return lines.reduce((sum, l) => sum + l.subtotalCents, 0);
}

/** "Speckled mug — Large", the way a receipt should name a line. */
export function lineTitle(line: Pick<OrderLine, "title" | "variantLabel">) {
  return line.variantLabel ? `${line.title} — ${line.variantLabel}` : line.title;
}

/**
 * Whether this order ships as a parcel — the fulfilment gate.
 *
 * An explicit delivery method answers by itself: `shipping` ships, and
 * explicit collection or digital delivery never does. `null` is the
 * never-configured and pre-methods case, and there the question is whether
 * any *line* holds physical goods — never `order.productKind`, which
 * describes the first line only. A basket whose first line is a download and
 * whose second is a mug is still a parcel, and the gate that read the header
 * left exactly that order impossible to mark shipped.
 */
export function shipsAsParcel(
  order: Pick<Order, "deliveryMethod">,
  lines: readonly Pick<OrderLine, "kind">[],
): boolean {
  if (order.deliveryMethod === "shipping") return true;
  if (order.deliveryMethod !== null) return false;
  return lines.some((line) => line.kind === "physical");
}

/**
 * How to name a whole order in one line.
 *
 * The order's header columns describe its first line, so using them straight
 * calls a four-item basket "Speckled mug" — in the seller's order list, in the
 * notification, in the shipping email and in the WhatsApp handoff. Naming the
 * rest is the difference between a seller packing one thing and packing four.
 */
export function orderSummaryTitle(order: {
  productTitle: string;
  variantLabel: string | null;
  itemCount: number;
}): string {
  const first = order.variantLabel
    ? `${order.productTitle} — ${order.variantLabel}`
    : order.productTitle;

  const more = order.itemCount - 1;
  return more > 0 ? `${first} + ${more} more item${more === 1 ? "" : "s"}` : first;
}
