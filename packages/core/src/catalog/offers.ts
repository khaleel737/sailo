/**
 * Whether a companion product may be put in front of this buyer — specs 36
 * and 08.
 *
 * Pure, and it decides one thing: eligibility. What an offer *costs* is decided
 * by `resolveLines` like every other line, from the seller's own row — a
 * cross-sell adds no pricing trust at all, and this module is deliberately
 * unable to price anything.
 *
 * THE TWO PLACES, AND WHY THEY ARE NOT THE SAME
 *
 *   `bump`       in-cart, one tap, above the pay button
 *   `crosssell`  after payment, on the thank-you page, never blocking anything
 *
 * Baymard found 66% of shoppers made to pass a cross-sell before completing a
 * transaction reported extreme frustration. That is Easytools' own argument for
 * post-purchase placement and it is right: the receipt, the files and the
 * invoice are visible before any offer is.
 */

export type OfferPlacement = "bump" | "crosssell";

export const OFFER_PLACEMENTS: OfferPlacement[] = ["bump", "crosssell"];

export function isOfferPlacement(value: unknown): value is OfferPlacement {
  return typeof value === "string" && (OFFER_PLACEMENTS as string[]).includes(value);
}

/** How an offer is drawn. Purely presentational; none of it changes a price. */
export type OfferDisplay = "card" | "compact" | "timer";

export const OFFER_DISPLAYS: OfferDisplay[] = ["card", "compact", "timer"];

export function isOfferDisplay(value: unknown): value is OfferDisplay {
  return typeof value === "string" && (OFFER_DISPLAYS as string[]).includes(value);
}

/** The offer row's own columns, as an eligibility decision reads them. */
export type OfferRow = {
  id: string;
  placement: string;
  sourceProductId: string | null;
  offerProductId: string;
  offerVariantId: string | null;
  parentId: string | null;
  priceCents: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  isActive: boolean;
};

/** What the offered product has to be, for the offer to be worth drawing. */
export type OfferedProduct = {
  id: string;
  kind: string;
  isPublished: boolean;
};

/**
 * Why an offer is not being shown. A closed union, because the caller does
 * different things with each: `expired` is written to `offer_events` so a
 * seller can see a window they set too tight, and the rest are simply silence.
 */
export type OfferRefusal =
  | "inactive"
  | "not_yet"
  | "expired"
  | "nested"
  | "gone"
  | "unpublished"
  | "already_bought"
  | "recurring";

/**
 * Whether this offer may be drawn right now.
 *
 * Every refusal here is also re-asked at the *charge*, which is where it counts:
 * this decides what a page renders, and a page can be open for an hour.
 *
 * `alreadyBought` matters more than it looks. Offering somebody the thing they
 * have just bought is the single most common way a cross-sell reads as broken,
 * and on a bump it is worse — the basket would quietly hold two of the same
 * product with only one of them attributed.
 */
export function offerEligibility(
  offer: OfferRow,
  product: OfferedProduct | null | undefined,
  opts: {
    now: Date;
    /** Product ids already in the basket, or already on the paid order. */
    alreadyBought: readonly string[];
    /** Whether this line can carry a recurring product. Bumps cannot. */
    allowsRecurring?: boolean;
  },
): { ok: true } | { ok: false; reason: OfferRefusal } {
  if (!offer.isActive) return { ok: false, reason: "inactive" };

  /*
   * A nested offer is ignored rather than rendered — `GAP §4.6`.
   *
   * `parentId` is always null in v1 and nothing writes it. A row that has one
   * came from a build that does not exist yet, and drawing it would show a
   * down-sell to somebody who never saw its parent.
   */
  if (offer.parentId) return { ok: false, reason: "nested" };

  const at = opts.now.getTime();
  if (offer.validFrom && at < offer.validFrom.getTime()) {
    return { ok: false, reason: "not_yet" };
  }
  if (offer.validUntil && at >= offer.validUntil.getTime()) {
    return { ok: false, reason: "expired" };
  }

  /*
   * A sold-out, unpublished or deleted offer product renders nothing and never
   * breaks the page — 08's degradation rule, restated by 36.
   *
   * Stock is *not* asked here and that is deliberate: `resolveLines` refuses a
   * sold-out line and a preorder-enabled one is legitimately sellable with
   * nothing on the shelf, so a stock check in this module would be a second
   * opinion about availability that could disagree with the one that decides.
   */
  if (!product) return { ok: false, reason: "gone" };
  if (!product.isPublished) return { ok: false, reason: "unpublished" };

  /*
   * A subscription cannot ride a one-time basket — spec 08's rule, and spec
   * 36's for instant charge. A membership is bought on its own, on a different
   * kind of Stripe session, and `resolveOrderIntent` refuses a mixed basket
   * outright: offering one as a bump would build a cart with no way to be paid
   * for, and the buyer would find out at the end.
   *
   * It may still be *offered* as a cross-sell, because taking one there routes
   * to a real checkout of its own.
   */
  if (product.kind === "membership" && opts.allowsRecurring !== true) {
    return { ok: false, reason: "recurring" };
  }

  if (opts.alreadyBought.includes(product.id)) {
    return { ok: false, reason: "already_bought" };
  }

  return { ok: true };
}

/**
 * Which offers apply to a basket or an order.
 *
 * An offer with no `sourceProductId` applies to everything the shop sells,
 * which is what a seller with one thing to cross-sell actually wants. One with
 * a source applies only where that product is present.
 *
 * De-duplicated by *offered product*, not by offer id: two offers pointing at
 * the same thing — one shop-wide, one attached to a product in this basket —
 * would otherwise draw it twice, and the buyer would read that as a bug.
 * Earlier `position` wins, so a seller's deliberate ordering survives.
 */
export function offersForBasket<T extends OfferRow>(
  offers: readonly T[],
  productIds: readonly string[],
): T[] {
  /*
   * Generic so the caller keeps its whole row.
   *
   * `OfferRow` is deliberately narrow — this module reads eleven columns and
   * should not be able to reach the rest — but narrowing the *return* would
   * make a filter silently discard everything a page needs to draw. The
   * constraint gets the checking without the loss.
   */
  const kept: T[] = [];
  const seen = new Set<string>();

  for (const offer of offers) {
    if (offer.sourceProductId && !productIds.includes(offer.sourceProductId)) continue;
    if (seen.has(offer.offerProductId)) continue;
    seen.add(offer.offerProductId);
    kept.push(offer);
  }
  return kept;
}

/* -------------------------------------------------------------------------- */
/*  What the seller reads                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Take-rate: taken ÷ shown.
 *
 * Zero shown is **null**, not zero. An offer nobody has seen has no rate, and
 * printing "0%" beside it would tell a seller their offer is failing when the
 * truth is that it has not run — which is the difference between switching it
 * off and leaving it alone.
 */
export function takeRate(counts: { shown: number; taken: number }): number | null {
  if (counts.shown <= 0) return null;
  return counts.taken / counts.shown;
}
