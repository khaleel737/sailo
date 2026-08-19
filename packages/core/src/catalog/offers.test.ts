import { describe, expect, it } from "vitest";
import {
  isOfferDisplay,
  isOfferPlacement,
  offerEligibility,
  offersForBasket,
  takeRate,
  type OfferRow,
} from "./offers";

/**
 * Eligibility decides what a page draws, and every rule here is re-asked at the
 * charge — a page can sit open for an hour. What is pinned below is that the
 * two never disagree about *why*, because the refusal reasons are what a seller
 * reads back as a take-rate they can act on.
 */

const NOW = new Date("2026-06-15T12:00:00Z");

function offer(over: Partial<OfferRow> = {}): OfferRow {
  return {
    id: "o1",
    placement: "crosssell",
    sourceProductId: null,
    offerProductId: "p2",
    offerVariantId: null,
    parentId: null,
    priceCents: null,
    validFrom: null,
    validUntil: null,
    isActive: true,
    ...over,
  };
}

const PRODUCT = { id: "p2", kind: "physical", isPublished: true };
const OPEN = { now: NOW, alreadyBought: [] as string[] };

describe("whether an offer may be drawn", () => {
  it("draws an active, published, in-window offer", () => {
    expect(offerEligibility(offer(), PRODUCT, OPEN)).toEqual({ ok: true });
  });

  it("refuses one the seller switched off", () => {
    expect(offerEligibility(offer({ isActive: false }), PRODUCT, OPEN)).toEqual({
      ok: false,
      reason: "inactive",
    });
  });

  it("keeps the two ends of a window apart", () => {
    // `not_yet` and `expired` are different facts: one is a seller who set a
    // launch, the other is one whose window was too tight, and only the second
    // is worth writing to `offer_events`.
    const window = offer({
      validFrom: new Date("2026-07-01T00:00:00Z"),
      validUntil: new Date("2026-08-01T00:00:00Z"),
    });
    expect(offerEligibility(window, PRODUCT, OPEN)).toEqual({
      ok: false,
      reason: "not_yet",
    });
    expect(
      offerEligibility(window, PRODUCT, { ...OPEN, now: new Date("2026-09-01T00:00:00Z") }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      offerEligibility(window, PRODUCT, { ...OPEN, now: new Date("2026-07-15T00:00:00Z") }),
    ).toEqual({ ok: true });
  });

  it("closes on the second the window ends", () => {
    const closes = offer({ validUntil: new Date("2026-06-15T12:00:00Z") });
    expect(offerEligibility(closes, PRODUCT, OPEN)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("ignores a nested offer rather than drawing it", () => {
    /*
     * `parentId` is always null in v1 and nothing writes it — GAP §4.6 refuses
     * three-level down-sell trees. A row that has one came from a build that
     * does not exist yet, and drawing it would show a down-sell to somebody who
     * never saw its parent.
     */
    expect(offerEligibility(offer({ parentId: "o0" }), PRODUCT, OPEN)).toEqual({
      ok: false,
      reason: "nested",
    });
  });

  it("degrades silently when the product is gone or unpublished", () => {
    // 08's rule, restated by 36: a sold-out, unpublished or deleted offer
    // product renders nothing and never breaks the page.
    expect(offerEligibility(offer(), null, OPEN)).toEqual({
      ok: false,
      reason: "gone",
    });
    expect(
      offerEligibility(offer(), { ...PRODUCT, isPublished: false }, OPEN),
    ).toEqual({ ok: false, reason: "unpublished" });
  });

  it("keeps a membership out of a bump but allows it as a cross-sell", () => {
    /*
     * A subscription cannot ride a one-time basket — spec 08's rule. Its
     * Checkout Session is a different Stripe mode and `resolveOrderIntent`
     * refuses a mixed basket outright, so a membership bump would build a cart
     * with no way to be paid for and the buyer would find out at the end.
     *
     * As a cross-sell it is fine: taking it routes to a checkout of its own.
     */
    const membership = { ...PRODUCT, kind: "membership" };
    expect(offerEligibility(offer(), membership, OPEN)).toEqual({
      ok: false,
      reason: "recurring",
    });
    expect(
      offerEligibility(offer(), membership, { ...OPEN, allowsRecurring: true }),
    ).toEqual({ ok: true });
  });

  it("never offers what the buyer already has", () => {
    // The most common way a cross-sell reads as broken, and on a bump it is
    // worse: the basket would hold two of one product with one attributed.
    expect(
      offerEligibility(offer(), PRODUCT, { ...OPEN, alreadyBought: ["p2"] }),
    ).toEqual({ ok: false, reason: "already_bought" });
  });
});

describe("which offers apply", () => {
  it("takes a shop-wide offer whatever is in the basket", () => {
    // Null source is "every product in this shop", which saves a seller
    // attaching the same offer to forty products by hand.
    expect(offersForBasket([offer()], ["p9"])).toHaveLength(1);
    expect(offersForBasket([offer()], [])).toHaveLength(1);
  });

  it("takes an attached offer only where its source is present", () => {
    const attached = offer({ sourceProductId: "p1" });
    expect(offersForBasket([attached], ["p1"])).toHaveLength(1);
    expect(offersForBasket([attached], ["p7"])).toHaveLength(0);
  });

  it("draws one offer per offered product, earliest first", () => {
    /*
     * Two offers pointing at the same thing — one shop-wide, one attached to a
     * product in this basket — would otherwise draw it twice, and a buyer reads
     * that as a bug. Earlier `position` wins, so the seller's own ordering
     * survives; the caller sorts before it gets here.
     */
    const kept = offersForBasket(
      [
        offer({ id: "first", sourceProductId: "p1" }),
        offer({ id: "second" }),
        offer({ id: "third", offerProductId: "p3" }),
      ],
      ["p1"],
    );
    expect(kept.map((o) => o.id)).toEqual(["first", "third"]);
  });

  it("keeps the caller's own row type", () => {
    // The generic is what stops a filter silently discarding everything a page
    // needs to draw.
    const rich = { ...offer(), title: "Add a lid" };
    expect(offersForBasket([rich], [])[0]?.title).toBe("Add a lid");
  });
});

describe("take-rate", () => {
  it("is null where nothing has been shown, not zero", () => {
    /*
     * "0%" beside an offer nobody has seen says it is failing; the truth is
     * that it has not run, and the two lead a seller to opposite decisions.
     */
    expect(takeRate({ shown: 0, taken: 0 })).toBeNull();
    expect(takeRate({ shown: 0, taken: 3 })).toBeNull();
  });

  it("divides taken by shown", () => {
    expect(takeRate({ shown: 40, taken: 10 })).toBeCloseTo(0.25);
  });
});

describe("the closed vocabularies", () => {
  it("takes only what the schema means", () => {
    expect(isOfferPlacement("bump")).toBe(true);
    expect(isOfferPlacement("crosssell")).toBe(true);
    expect(isOfferPlacement("upsell")).toBe(false);
    expect(isOfferPlacement(null)).toBe(false);

    expect(isOfferDisplay("timer")).toBe(true);
    expect(isOfferDisplay("banner")).toBe(false);
  });
});
