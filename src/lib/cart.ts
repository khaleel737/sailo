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

/** Two lines are the same line when they're the same variant of the same product. */
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

/** What the server needs: identity and counts, none of the cached money. */
export function toOrderItems(lines: CartLine[]) {
  return lines.map((line) => ({
    productId: line.productId,
    variantId: line.variantId ?? undefined,
    quantity: line.quantity,
    scheduledFor: line.scheduledFor,
  }));
}
