/**
 * The basket, kept in the browser.
 *
 * Nothing here is trusted: the titles and prices are a cache so the drawer can
 * paint instantly, and every one of them is re-read from the database before a
 * total is shown or an order is taken. What the cart really carries is a list
 * of "this product, this variant, this many".
 */

export type CartLine = {
  productId: string;
  variantId: string | null;
  quantity: number;
  /** ISO instant, for a service the buyer scheduled. */
  scheduledFor?: string;
  /**
   * What the buyer named, in minor units, on a pay-what-you-want line — spec 43.
   *
   * The one number in this file that is *not* a cache. Everything else here is
   * re-read from the database before a total is shown, which is what makes a
   * tampered basket harmless; this is an answer only the buyer has, so it
   * travels with the order and the server clamps it to the seller's floor in
   * `resolveLines`. Absent on every fixed-price line, where it is ignored
   * outright rather than validated.
   */
  priceCents?: number;

  // Cached for first paint only.
  title: string;
  label: string;
  kind: string;
  unitPriceCents: number;
  imageUrl: string | null;
};

const PREFIX = "sailo:cart:";
/** More than this in one basket is a bug or a bot, not a shopper. */
const MAX_LINES = 50;
const MAX_QUANTITY = 999;

export function cartKey(shopId: string) {
  return `${PREFIX}${shopId}`;
}

/**
 * Two lines are the same line when they're the same variant of the same product.
 *
 * Deliberately unchanged by pay-what-you-want. A buyer who adds the same
 * name-your-price download twice at two different amounts gets one line at the
 * amount they named *last*, times two — because `addLine` spreads the incoming
 * line over the existing one. Keying on the amount instead would leave two rows
 * for one product in the drawer, which reads as a bug, and neither reading is
 * more correct than the other: the buyer is looking at the number either way,
 * and the server prices whatever the line finally says.
 */
export function lineKey(line: Pick<CartLine, "productId" | "variantId">) {
  return `${line.productId}:${line.variantId ?? ""}`;
}

export function readCart(shopId: string): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(cartKey(shopId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCartLine).slice(0, MAX_LINES);
  } catch {
    // A corrupt or blocked store just means an empty basket.
    return [];
  }
}

export function writeCart(shopId: string, lines: CartLine[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cartKey(shopId), JSON.stringify(lines));
  } catch {
    // Private browsing, quota, whatever — the cart still works in memory.
  }
}

/**
 * Empties the stored basket directly, for pages outside the cart's provider —
 * the invoice a paid card order lands on, most of all.
 */
export function clearStoredCart(shopId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(cartKey(shopId));
  } catch {
    // Nothing stored, nothing to empty.
  }
}

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<CartLine>;
  return (
    typeof line.productId === "string" &&
    typeof line.quantity === "number" &&
    line.quantity > 0
  );
}

/** Adds to the matching line rather than repeating it. */
export function addLine(lines: CartLine[], incoming: CartLine): CartLine[] {
  const key = lineKey(incoming);
  const existing = lines.find((l) => lineKey(l) === key);

  if (!existing) {
    return [...lines, clamp(incoming)].slice(0, MAX_LINES);
  }

  return lines.map((line) =>
    lineKey(line) === key
      ? clamp({
          ...line,
          ...incoming,
          quantity: line.quantity + incoming.quantity,
        })
      : line,
  );
}

export function setQuantity(
  lines: CartLine[],
  key: string,
  quantity: number,
): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => lineKey(l) !== key);
  return lines.map((line) =>
    lineKey(line) === key ? clamp({ ...line, quantity }) : line,
  );
}

export function removeLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => lineKey(l) !== key);
}

function clamp(line: CartLine): CartLine {
  return {
    ...line,
    quantity: Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(line.quantity) || 1)),
  };
}

export function cartCount(lines: CartLine[]) {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/** The cached total. Good enough for a button; never good enough to charge. */
export function cachedTotal(lines: CartLine[]) {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

/**
 * What the server needs: identity, counts, and the one price it cannot know.
 *
 * `unitPriceCents` still does not travel and never will — it is a cache for the
 * drawer's first paint, and sending it would be the browser naming what it is
 * charged. `priceCents` is the opposite case and the only one: on a
 * pay-what-you-want line the amount *is* the buyer's answer, so there is
 * nowhere else it could come from. It is clamped to the seller's floor at the
 * server, in `resolveLines`, which both sinks are built on.
 */
export function toOrderItems(lines: CartLine[]) {
  return lines.map((line) => ({
    productId: line.productId,
    variantId: line.variantId ?? undefined,
    quantity: line.quantity,
    scheduledFor: line.scheduledFor,
    priceCents: line.priceCents,
  }));
}

/* -------------------------------------------------------------------------- */
/*  The order in flight                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A card checkout leaves the page before any money moves: the basket becomes
 * an order intent, and the buyer goes to Stripe — where they may pay, or may
 * close the tab and never come back. Emptying the basket at the redirect
 * punished the buyer who abandoned: they returned to a shop that had forgotten
 * everything they picked.
 *
 * So the basket stays, and the order's id is parked here instead. Whoever
 * learns the order settled — the invoice page the payment returns to, or the
 * storefront asking the server on the next visit — empties the basket then,
 * which is the moment it actually stopped being a basket.
 */
const PENDING_PREFIX = "sailo:pending:";

function pendingKey(shopId: string) {
  return `${PENDING_PREFIX}${shopId}`;
}

export function markPendingOrder(shopId: string, orderId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pendingKey(shopId), orderId);
  } catch {
    // Then nothing is parked and a paid basket may outlive its order — the
    // failure that leaves the buyer with too much rather than too little.
  }
}

export function readPendingOrder(shopId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(pendingKey(shopId));
  } catch {
    return null;
  }
}

export function clearPendingOrder(shopId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(pendingKey(shopId));
  } catch {
    // Nothing parked, nothing to forget.
  }
}
