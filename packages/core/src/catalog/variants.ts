import type { Product, ProductOption, VariantOptions } from "@sailo/db/schema";

/**
 * Variants are the sellable combinations of a product's options — the medium
 * pizza, the red shirt in large. Everything here is pure so the admin editor,
 * the storefront and the order action agree on price and availability without
 * one of them re-deriving the rules.
 */

export const MAX_OPTIONS = 3;
export const MAX_VALUES_PER_OPTION = 12;
/** Shopify's ceiling too — past this a seller wants separate products. */
export const MAX_VARIANTS = 100;
/** Hard cap on a single order line, regardless of stock. */
export const MAX_QUANTITY = 999;

/* -------------------------------------------------------------------------- */
/*  Structural shapes                                                          */
/*                                                                             */
/*  Deliberately narrow so a client component can pass a trimmed object        */
/*  instead of a full database row.                                            */
/* -------------------------------------------------------------------------- */

export type PricedProduct = Pick<Product, "priceCents" | "compareAtCents">;

export type StockedProduct = Pick<
  Product,
  "inStock" | "trackInventory" | "stockQuantity"
>;

export type VariantLike = {
  options: VariantOptions;
  priceCents: number | null;
  compareAtCents: number | null;
  stockQuantity: number | null;
  isAvailable: boolean;
};

/* -------------------------------------------------------------------------- */
/*  Options                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Trims, de-duplicates and caps a seller's option definitions. An option with
 * no name or no values isn't a choice, so it's dropped rather than kept empty.
 */
export function normalizeOptions(raw: ProductOption[]): ProductOption[] {
  const seen = new Set<string>();
  const clean: ProductOption[] = [];

  for (const option of raw) {
    const name = option.name?.trim().slice(0, 40);
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    const values: string[] = [];
    const valueSeen = new Set<string>();
    for (const value of option.values ?? []) {
      const v = value?.trim().slice(0, 60);
      if (!v || valueSeen.has(v.toLowerCase())) continue;
      valueSeen.add(v.toLowerCase());
      values.push(v);
      if (values.length >= MAX_VALUES_PER_OPTION) break;
    }
    if (values.length === 0) continue;

    seen.add(key);
    clean.push({ name, values });
    if (clean.length >= MAX_OPTIONS) break;
  }

  return clean;
}

/**
 * Every combination of the options, in the order a person reads them: the
 * first option varies slowest, so Small/Red, Small/Blue, Medium/Red…
 */
export function combinations(options: ProductOption[]): VariantOptions[] {
  if (options.length === 0) return [];

  let rows: VariantOptions[] = [{}];
  for (const option of options) {
    const next: VariantOptions[] = [];
    for (const row of rows) {
      for (const value of option.values) {
        next.push({ ...row, [option.name]: value });
        if (next.length >= MAX_VARIANTS) break;
      }
      if (next.length >= MAX_VARIANTS) break;
    }
    rows = next;
  }
  return rows.slice(0, MAX_VARIANTS);
}

/**
 * A stable identity for a combination, used to match a stored variant against
 * a fresh selection. Keys are sorted so `{Size, Colour}` and `{Colour, Size}`
 * describe the same shirt.
 */
export function optionKey(options: VariantOptions): string {
  // `.sort()`: Hermes has no `toSorted`. `Object.keys` just made the array, so
  // mutating it disturbs nothing. See the note in `./countries.ts`.
  return Object.keys(options)
    .sort()
    .map((k) => `${k.toLowerCase()}=${String(options[k]).toLowerCase()}`)
    .join("|");
}

export function sameOptions(a: VariantOptions, b: VariantOptions): boolean {
  return optionKey(a) === optionKey(b);
}

/** "Large / Red" — option order wins over object key order when known. */
export function variantLabel(
  options: VariantOptions,
  productOptions?: ProductOption[],
): string {
  const names =
    productOptions && productOptions.length > 0
      ? productOptions.map((o) => o.name).filter((n) => n in options)
      : Object.keys(options);
  return names
    .map((n) => options[n])
    .filter(Boolean)
    .join(" / ");
}

export function findVariant<V extends { options: VariantOptions }>(
  variants: V[],
  selection: VariantOptions,
): V | undefined {
  const key = optionKey(selection);
  return variants.find((v) => optionKey(v.options) === key);
}

/* -------------------------------------------------------------------------- */
/*  Price                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A blank variant price means "same as the product", not "free".
 *
 * Typed to the two fields it reads rather than a whole variant, so a caller
 * with just a price — a test, a projection — doesn't have to invent stock and
 * availability to ask what something costs.
 */
export function variantPrice(
  product: PricedProduct,
  variant?: Partial<Pick<VariantLike, "priceCents">> | null,
): number {
  return variant?.priceCents ?? product.priceCents;
}

export function variantCompareAt(
  product: PricedProduct,
  variant?: Partial<Pick<VariantLike, "priceCents" | "compareAtCents">> | null,
): number | null {
  // A variant that sets its own price also owns its own strike-through, or it
  // would advertise a saving against a different item's price.
  if (variant?.priceCents !== null && variant?.priceCents !== undefined) {
    // A partial variant may omit the field entirely; absent means none.
    return variant.compareAtCents ?? null;
  }
  return variant?.compareAtCents ?? product.compareAtCents;
}

/**
 * What the card should show. Variants that cost different amounts collapse to
 * "from the cheapest" rather than quoting a price the buyer may not get.
 */
export function priceRange(
  product: PricedProduct,
  variants: VariantLike[],
): { min: number; max: number; varies: boolean } {
  const sellable = variants.filter((v) => v.isAvailable);
  const pool = sellable.length > 0 ? sellable : variants;
  if (pool.length === 0) {
    return { min: product.priceCents, max: product.priceCents, varies: false };
  }

  const prices = pool.map((v) => variantPrice(product, v));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { min, max, varies: min !== max };
}

/* -------------------------------------------------------------------------- */
/*  Stock                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Units left, or null when nobody is counting. Null and 0 are genuinely
 * different answers: one means "sell as many as you like", the other "none".
 */
export function unitsLeft(
  product: StockedProduct,
  variant?: VariantLike | null,
): number | null {
  if (!product.trackInventory) return null;
  const quantity = variant ? variant.stockQuantity : product.stockQuantity;
  return quantity === null ? null : Math.max(0, quantity);
}

/** True when a buyer can order this right now. */
export function isSellable(
  product: StockedProduct,
  variant?: VariantLike | null,
): boolean {
  if (!product.inStock) return false;
  if (variant && !variant.isAvailable) return false;
  const left = unitsLeft(product, variant);
  return left === null || left > 0;
}

/** The most a buyer may put in the quantity box. */
export function maxOrderable(
  product: StockedProduct,
  variant?: VariantLike | null,
): number {
  const left = unitsLeft(product, variant);
  return left === null ? MAX_QUANTITY : Math.min(MAX_QUANTITY, left);
}

/** True when at least one combination is still sellable. */
export function anySellable(
  product: StockedProduct,
  variants: VariantLike[],
): boolean {
  if (variants.length === 0) return isSellable(product);
  return variants.some((v) => isSellable(product, v));
}

/**
 * Show "only 3 left" below this, and stay quiet above it — a shop with 400 in
 * the back doesn't need to broadcast it.
 */
export const LOW_STOCK_THRESHOLD = 5;

export function isLowStock(left: number | null): left is number {
  return left !== null && left > 0 && left <= LOW_STOCK_THRESHOLD;
}

/* -------------------------------------------------------------------------- */
/*  Storefront                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A variant as the order sheet sees it: prices already resolved and stock
 * already judged, so the browser never has to know the rules — or be trusted
 * with them.
 */
export type CheckoutVariant = {
  id: string;
  options: VariantOptions;
  priceCents: number;
  compareAtCents: number | null;
  available: boolean;
  /** Units left, or null when nobody is counting. */
  unitsLeft: number | null;
  imageUrl: string | null;
};

export function toCheckoutVariants(
  product: PricedProduct & StockedProduct,
  variants: (VariantLike & { id: string; imageUrl: string | null })[],
): CheckoutVariant[] {
  return variants.map((v) => ({
    id: v.id,
    options: v.options,
    priceCents: variantPrice(product, v),
    compareAtCents: variantCompareAt(product, v),
    available: isSellable(product, v),
    unitsLeft: unitsLeft(product, v),
    imageUrl: v.imageUrl,
  }));
}

/**
 * The combination a picker should land on after choosing `value` for `name`.
 *
 * Keeps the rest of the selection when that exact combination is for sale,
 * and otherwise jumps to the nearest sellable one carrying the value — so a
 * buyer who picks "red" on a sold-out large lands on a red that exists. Null
 * only when nothing at all carries the value, which is when the chip should
 * have been disabled.
 *
 * One function because two pickers offer it — the card's quick-add and the
 * product page — and a buyer who meets both must meet one behaviour.
 */
export function retargetSelection(
  variants: CheckoutVariant[],
  selection: VariantOptions,
  name: string,
  value: string,
): CheckoutVariant | null {
  const next = { ...selection, [name]: value };
  const exact = findVariant(variants, next) ?? null;
  if (exact?.available) return exact;
  return (
    variants.find((v) => v.available && v.options[name] === value) ?? exact
  );
}

/* -------------------------------------------------------------------------- */
/*  Kinds                                                                      */
/* -------------------------------------------------------------------------- */

export type ProductKind =
  | "physical"
  | "digital"
  | "service"
  | "event"
  | "membership";

export const PRODUCT_KIND_VALUES: ProductKind[] = [
  "physical",
  "digital",
  "service",
  "event",
  "membership",
];

export function isProductKind(value: string): value is ProductKind {
  return (PRODUCT_KIND_VALUES as string[]).includes(value);
}

/** Only physical goods get delivered; a file and an appointment don't. */
export function needsDelivery(kind: string): boolean {
  return kind === "physical";
}

/**
 * Whether a line hands the buyer its value *before* they have paid — the one
 * thing that makes a pay-in-person rail (cash on delivery / at the door / at
 * the appointment) unsafe, because there "pay later" can become "pay never".
 *
 * Only an instant-unlock digital file does this. A file held until payment, a
 * physical good, an appointment and an event ticket are all collected at a
 * moment the seller controls — the doorstep, the venue door, the appointment —
 * so cash-in-person is safe for them. `heldUntilPaid` is the product's
 * `releaseOnPayment`: true means the download waits for the seller to confirm.
 */
export function releasesBeforePayment(kind: string, heldUntilPaid: boolean): boolean {
  return kind === "digital" && !heldUntilPaid;
}

/**
 * Whether this line ever puts the buyer and the seller in the same place — the
 * doorstep, the studio, the venue door.
 *
 * The other half of the pay-in-person question, and the half that was missing.
 * `releasesBeforePayment` asks whether cash *can safely* be collected later;
 * this asks whether there is a later at which anyone is standing there. An
 * online appointment and an online event have none, and neither does a
 * download of any kind — nothing reaches anyone on a video call, so "pay when
 * the order reaches you" was an offer with no moment behind it.
 */
export function handedOverInPerson(product: {
  kind: string;
  serviceMode: string;
}): boolean {
  if (product.kind === "physical") return true;
  // A service and an event both carry the seller's own online/in-person
  // switch, and a link is not a place.
  if (product.kind === "service" || product.kind === "event") {
    return product.serviceMode !== "online";
  }
  /*
   * A membership is somewhere you turn up — that is very often the entire
   * product. A gym taking cash at the door is the single most common manual
   * membership there is, and refusing it here would have left exactly those
   * sellers unable to sell the thing they sell.
   *
   * Safe on the other half of the pay-in-person question too: a manual
   * membership grants nothing until the seller confirms the money, because
   * the subscription sits `incomplete` until then. There is no version of
   * this where somebody gets in before paying.
   */
  if (product.kind === "membership") return product.serviceMode !== "online";
  return false;
}

/**
 * Whether a pay-in-person rail belongs on this order at all.
 *
 * Both halves have to hold, and each catches what the other misses:
 *
 *   somewhere to hand the cash over — otherwise the rail promises a doorstep
 *   the order does not have, which is how an online video call came to offer
 *   "pay when the order reaches you";
 *
 *   and nothing in the basket that has already gone by then — otherwise the
 *   seller hands over an instant download and waits for money that never
 *   comes.
 *
 * One function rather than the expression written out at each sink, because it
 * was written out at four — the checkout quote, the order itself, the product
 * page's structured data and the buy box — and four copies of a rule are four
 * chances for the button a buyer presses to disagree with the answer the
 * server gives them.
 *
 * A mixed basket is judged as one order: a mug alongside a held file can be
 * paid for at the door, because the door is where both arrive.
 */
export function cartCanPayInPerson(
  items: readonly {
    kind: string;
    serviceMode: string;
    releaseOnPayment: boolean;
  }[],
): boolean {
  if (!items.some(handedOverInPerson)) return false;
  return !items.some((item) =>
    releasesBeforePayment(item.kind, item.releaseOnPayment),
  );
}

export type ServiceMode = "in_person" | "online";

export function isServiceMode(value: string): value is ServiceMode {
  return value === "in_person" || value === "online";
}

export function clampQuantity(value: number, max = MAX_QUANTITY): number {
  const n = Math.trunc(value) || 1;
  return Math.min(Math.max(n, 1), Math.max(1, max));
}
