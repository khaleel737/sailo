import type { Product, ProductVariant } from "@sailo/db/schema";
import { variantPrice, type PricedProduct } from "./variants";

/**
 * The two things a price can be besides a number the seller typed: an amount
 * the *buyer* chooses, and a number that is only on sale between two dates.
 *
 * All pure, and deliberately so. `resolveLines` is the only sink that may
 * decide what a line costs, but four other surfaces have to agree with it
 * before the buyer gets there — the buy box renders the amount field, the
 * basket re-prices on every keystroke, the storefront card decides whether to
 * draw a product at all, and the admin form writes the columns. A rule
 * re-derived at each of those is a rule that will disagree with the checkout
 * at one of them, and the one that costs money is the price.
 *
 * WHY PAY-WHAT-YOU-WANT IS THE ONLY PRICE THAT COMES FROM A REQUEST
 *
 * Everywhere else in this checkout, `unitPriceCents` is read from the database
 * — that is what makes a tampered basket buy the same thing at the same price
 * as an honest one. PWYW is the single exception in the product, and so the
 * clamp below is the entire security content of the feature. It is applied in
 * `resolveLines`, which both `previewOrder` and `createOrderIntent` are built
 * on, so the quote and the charge cannot disagree about what was entered.
 */

/* -------------------------------------------------------------------------- */
/*  Pricing mode                                                               */
/* -------------------------------------------------------------------------- */

/**
 * `fixed` is every product ever sold here. `pwyw` is the buyer's own number,
 * above a floor.
 *
 * There is deliberately no `donation` mode, and no sixth product kind for one
 * either. A donation is `pwyw` with a floor of zero on a digital product with
 * no file — a *pricing* difference, entirely — and expressing it as a kind
 * would fork every `switch` on `ProductKind` in the tree (fulfilment, the
 * storefront tile, the order line, the CSV, the API resource shape) to say
 * something none of them are asking about. The product-template picker still
 * offers "Donation": a template that sets three columns is not a kind.
 */
export type PricingMode = "fixed" | "pwyw";

export const PRICING_MODES: PricingMode[] = ["fixed", "pwyw"];

export function isPricingMode(value: unknown): value is PricingMode {
  return typeof value === "string" && (PRICING_MODES as string[]).includes(value);
}

/** The columns that decide what a buyer may pay. Narrow, so a card can ask. */
export type PricedByBuyer = PricedProduct & {
  pricingMode: string;
  minPriceCents: number | null;
  suggestedPriceCents: number | null;
};

/** A variant, as this module reads one. A trimmed literal satisfies it. */
export type PricedVariantLike = Partial<
  Pick<ProductVariant, "priceCents" | "compareAtCents">
> | null;

export function isPwyw(product: Pick<PricedByBuyer, "pricingMode">): boolean {
  return product.pricingMode === "pwyw";
}

/**
 * The least a buyer may pay.
 *
 * **Zero and null are different answers**, and conflating them is the whole of
 * the blank-versus-zero bug shape on this column. `0` is the seller saying
 * "free is allowed" — a donation, a name-your-price download. `null` is "not
 * configured", which must read as the list price, so a product switched to
 * PWYW before the seller has typed a floor does not become free the moment the
 * mode changes.
 *
 * The list price, not the product's: a variant that sets its own price sets
 * its own floor with it, or the medium would be floored at the small's price.
 */
export function pwywFloorCents(
  product: PricedByBuyer,
  variant?: PricedVariantLike,
): number {
  const floor = product.minPriceCents;
  if (floor === null || floor === undefined || !Number.isFinite(floor)) {
    return Math.max(0, variantPrice(product, variant));
  }
  return Math.max(0, Math.trunc(floor));
}

/**
 * What the amount field opens on.
 *
 * Never below the floor — a suggestion the server would refuse is a field that
 * fails on submit for a buyer who changed nothing.
 */
export function pwywSuggestedCents(
  product: PricedByBuyer,
  variant?: PricedVariantLike,
): number {
  const floor = pwywFloorCents(product, variant);
  const suggested = product.suggestedPriceCents;
  if (suggested === null || suggested === undefined || !Number.isFinite(suggested)) {
    return Math.max(floor, variantPrice(product, variant));
  }
  return Math.max(floor, Math.trunc(suggested));
}

/**
 * The buyer's number, made safe.
 *
 * This is the clamp. Everything it refuses arrives from a request body, so
 * every one of these cases is reachable by hand and none of them by using the
 * shop:
 *
 *   not a number at all       → the suggested amount, which is what the field
 *                               would have shown them
 *   `NaN` / `Infinity`        → likewise. `Math.trunc(Infinity)` is `Infinity`
 *                               and would reach `computeTotals` as a total no
 *                               currency can settle
 *   a fraction of a minor unit → truncated. Minor units are integers; 12.5
 *                               cents is not an amount
 *   negative                  → the floor. A negative line would subtract from
 *                               the basket's subtotal, which is a discount the
 *                               buyer wrote themselves
 *   below the floor           → the floor
 *
 * Deliberately **not** capped above. A buyer choosing to pay more than the
 * suggestion is the entire point of the feature, and `MAX_QUANTITY` and the
 * currency's own settlement ceiling bound the arithmetic already.
 */
export function clampPwywCents(
  product: PricedByBuyer,
  variant: PricedVariantLike,
  requested: unknown,
): number {
  const floor = pwywFloorCents(product, variant);

  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return pwywSuggestedCents(product, variant);
  }
  return Math.max(floor, Math.trunc(requested));
}

/**
 * What a line actually costs, whichever mode the product is in.
 *
 * One function so the two branches cannot be written out separately at the
 * four call sites that need them — which is how a guard ends up at one sink
 * and not its twin. A fixed product ignores `requested` entirely.
 */
export function resolvedUnitPriceCents(
  product: PricedByBuyer,
  variant: PricedVariantLike,
  requested: unknown,
): number {
  return isPwyw(product)
    ? clampPwywCents(product, variant, requested)
    : variantPrice(product, variant);
}

/**
 * Whether a strike-through belongs beside this price.
 *
 * A PWYW line has no "was": the buyer chose the number, so a higher one
 * crossed out beside it is advertising a saving against nothing.
 */
export function showsCompareAt(product: Pick<PricedByBuyer, "pricingMode">): boolean {
  return !isPwyw(product);
}

/* -------------------------------------------------------------------------- */
/*  Sell windows                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether this product is on sale at a given instant, and if not, which side
 * of the window we are on.
 *
 * `early` and `ended` are kept apart because the buyer is told different
 * things — "opens on the 3rd" is an invitation and "no longer available" is
 * not — and because spec 33 branches on it: an unreleased product takes a
 * back-in-stock request, and an ended one may take a preorder.
 */
export type SellWindowState = "open" | "early" | "ended";

export type WindowedProduct = {
  sellFrom: Date | null;
  sellUntil: Date | null;
};

export type WindowedVariant = WindowedProduct | null | undefined;

/**
 * The window this exact combination sells in.
 *
 * **A variant narrows its product's window and can never widen it.** An
 * early-bird tier that closes on Friday inside a launch that runs all month is
 * the case the column exists for; a tier that claimed to open before its own
 * product does would sell something the seller has not put on sale yet, which
 * is a different thing entirely from what they configured.
 *
 * So the effective start is the *later* of the two and the effective end is
 * the *earlier*. Null on either side means "no bound from here", not "no
 * bound at all" — which is why this cannot be a pair of `??`.
 */
export function effectiveSellWindow(
  product: WindowedProduct,
  variant?: WindowedVariant,
): WindowedProduct {
  const from = laterOf(product.sellFrom, variant?.sellFrom ?? null);
  const until = earlierOf(product.sellUntil, variant?.sellUntil ?? null);
  return { sellFrom: from, sellUntil: until };
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function earlierOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * Computed, never stored.
 *
 * A stored `isAvailable` flag drifts the moment a cron misses a tick, and the
 * drift is invisible: the product simply goes on selling, or stops. Comparing
 * two instants costs nothing and cannot be stale.
 *
 * Both bounds are inclusive of the open side: a window that starts at nine
 * o'clock is open at nine o'clock, and one that ends at five is closed at
 * five. The seller picked the times; a buyer arriving on the second is served
 * by the reading that does not surprise either of them.
 */
export function sellWindowState(
  product: WindowedProduct,
  variant: WindowedVariant,
  now: Date,
): SellWindowState {
  const { sellFrom, sellUntil } = effectiveSellWindow(product, variant);
  const at = now.getTime();

  if (sellFrom && at < sellFrom.getTime()) return "early";
  if (sellUntil && at >= sellUntil.getTime()) return "ended";
  return "open";
}

export function withinSellWindow(
  product: WindowedProduct,
  variant: WindowedVariant,
  now: Date,
): boolean {
  return sellWindowState(product, variant, now) === "open";
}

/**
 * Whether a product outside its window should disappear from the grid or stay
 * on it reading as unavailable.
 *
 * Both are wanted and neither is the obvious default. A launch that has ended
 * should very often stay visible — it is where the back-in-stock form lives,
 * and a page that 404s loses the buyer and the link they were sent. A product
 * that is not out yet more often should not be there at all.
 */
export function hiddenOutsideWindow(
  product: WindowedProduct & { hideWhenUnavailable: boolean },
  variant: WindowedVariant,
  now: Date,
): boolean {
  return product.hideWhenUnavailable && !withinSellWindow(product, variant, now);
}

/* -------------------------------------------------------------------------- */
/*  What the seller may be refused                                             */
/* -------------------------------------------------------------------------- */

/**
 * A membership may not be pay-what-you-want.
 *
 * A recurring buyer-chosen amount means a Stripe Price per buyer — Prices are
 * immutable and per-amount, so a hundred members choosing a hundred numbers is
 * a hundred Price objects on the seller's account, each of which has to be
 * found again at every renewal. Refused with a message rather than silently
 * ignored, exactly as coupons on memberships already are: a seller who set it
 * and was not told would believe they were selling something they are not.
 */
export function pwywAllowedForKind(kind: string): boolean {
  return kind !== "membership";
}

/**
 * The mode a product is actually saved with.
 *
 * Anything unrecognised, and anything a kind refuses, falls back to `fixed` —
 * a product whose mode is a typo must go on selling at its list price rather
 * than becoming free.
 */
export function normalizePricingMode(value: unknown, kind: string): PricingMode {
  if (!isPricingMode(value)) return "fixed";
  if (value === "pwyw" && !pwywAllowedForKind(kind)) return "fixed";
  return value;
}

/** A full product row satisfies `PricedByBuyer`; this states it once. */
export function pricedByBuyer(product: Product): PricedByBuyer {
  return product;
}
