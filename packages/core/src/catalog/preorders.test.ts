import { describe, expect, it } from "vitest";
import {
  buyState,
  normalizeContact,
  offersStockRequest,
  preorderExpectedAt,
  preorderLimit,
  takesPreorders,
  type PreorderProduct,
} from "./preorders";

/**
 * The failure this whole feature is shaped to prevent is telling somebody about
 * the red one when they asked about the blue — so most of what is pinned here
 * is the variant falling back to the product without ever being confused with
 * it.
 */

function product(over: Partial<PreorderProduct> = {}): PreorderProduct {
  return {
    preorderEnabled: true,
    preorderExpectedAt: new Date("2026-10-01T00:00:00Z"),
    preorderLimit: null,
    ...over,
  };
}

describe("the promised date", () => {
  it("takes the combination's own where it has one", () => {
    // The blue medium may be six weeks out while the red small is two, and
    // showing the product's date for the slower one tells the buyer something
    // untrue at the moment they are deciding.
    const slower = { preorderExpectedAt: new Date("2026-12-01T00:00:00Z") };
    expect(preorderExpectedAt(product(), slower)).toEqual(
      new Date("2026-12-01T00:00:00Z"),
    );
  });

  it("falls back to the product's when the combination has none", () => {
    expect(preorderExpectedAt(product(), { preorderExpectedAt: null })).toEqual(
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(preorderExpectedAt(product(), null)).toEqual(
      new Date("2026-10-01T00:00:00Z"),
    );
  });

  it("answers null when nobody gave one, which is an answer", () => {
    /*
     * Null means "no date given", and the buy box renders it as that. It is
     * never a blank: a blank reads as a date that failed to load, and a buyer
     * will wait for it.
     */
    expect(preorderExpectedAt(product({ preorderExpectedAt: null }), null)).toBeNull();
  });
});

describe("the ceiling", () => {
  it("takes the combination's own, and does not narrow to the product's", () => {
    /*
     * Unlike a sell window, a limit *replaces* rather than narrows. A seller who
     * can make fifty of the blue and twenty of the red is describing two
     * separate runs, not a subset of one — so twenty here is twenty, even
     * though the product says fifty.
     */
    expect(preorderLimit(product({ preorderLimit: 50 }), { preorderLimit: 20 })).toBe(20);
    expect(preorderLimit(product({ preorderLimit: 20 }), { preorderLimit: 50 })).toBe(50);
  });

  it("falls back to the product's, and null is uncapped", () => {
    expect(preorderLimit(product({ preorderLimit: 50 }), null)).toBe(50);
    expect(preorderLimit(product(), null)).toBeNull();
  });

  it("reads zero and nonsense as uncapped rather than as a ban", () => {
    // A seller who wants to stop taking preorders has the switch. A zero here
    // is far more likely a cleared field, and reading it as "none" would take
    // the product off sale with nothing on any screen saying why.
    expect(preorderLimit(product({ preorderLimit: 0 }), null)).toBeNull();
    expect(preorderLimit(product({ preorderLimit: -4 }), null)).toBeNull();
    expect(preorderLimit(product({ preorderLimit: Number.NaN }), null)).toBeNull();
  });
});

describe("what the button offers", () => {
  it("sells normally while there is stock, even with preorders on", () => {
    // A preorder-enabled product that still has stock is not a preorder, and
    // must not be shown a six-week date for a unit that is on the shelf.
    expect(buyState(product(), { sellable: true })).toBe("in_stock");
  });

  it("offers a preorder once the shelf is empty", () => {
    expect(buyState(product(), { sellable: false })).toBe("preorder");
  });

  it("says sold out where the seller has not turned it on", () => {
    // Three states rather than two: a buyer told "sold out" on something they
    // could have preordered leaves, and that is the sale this exists to keep.
    expect(buyState(product({ preorderEnabled: false }), { sellable: false })).toBe(
      "sold_out",
    );
    expect(takesPreorders(product({ preorderEnabled: false }))).toBe(false);
  });
});

describe("where the queue is offered", () => {
  it("is offered when a buyer cannot buy and might be able to later", () => {
    expect(offersStockRequest({ sellable: false, takesPreorders: false })).toBe(true);
  });

  it("is not offered when they can just buy it", () => {
    expect(offersStockRequest({ sellable: true, takesPreorders: false })).toBe(false);
  });

  it("is not offered on a preorder", () => {
    // There the answer to "when can I have it" is a button, not a queue.
    expect(offersStockRequest({ sellable: false, takesPreorders: true })).toBe(false);
  });
});

describe("the contact", () => {
  it("takes an address or a number, never demanding both", () => {
    expect(normalizeContact({ email: "Ada@Example.com" })).toEqual({
      email: "ada@example.com",
      phone: null,
    });
    expect(normalizeContact({ phone: "+44 7700 900 123" })).toEqual({
      email: null,
      phone: "+447700900123",
    });
  });

  it("lower-cases and trims, because the unique index depends on it", () => {
    /*
     * A row stored with a trailing space is a *different row* from the same
     * request without one, so the index holding "one open request per contact
     * per variant" would not fire — and the buyer would be told twice.
     */
    expect(normalizeContact({ email: "  Ada@Example.com  " })?.email).toBe(
      "ada@example.com",
    );
  });

  it("refuses what could never be reached", () => {
    // Not validation — refusing to store a row that can never be sent to.
    expect(normalizeContact({ email: "ada" })).toBeNull();
    expect(normalizeContact({ phone: "+" })).toBeNull();
    expect(normalizeContact({ phone: "12345" })).toBeNull();
    expect(normalizeContact({})).toBeNull();
    expect(normalizeContact({ email: "   ", phone: "  " })).toBeNull();
  });

  it("keeps whichever half is usable when the other is not", () => {
    expect(normalizeContact({ email: "nope", phone: "+447700900123" })).toEqual({
      email: null,
      phone: "+447700900123",
    });
  });

  it("refuses an over-long value rather than truncating it", () => {
    /*
     * The distinction this test exists for, and it found a real defect: the
     * first version sliced to 200 characters and *then* looked for an `@`, so a
     * long local part had its domain cut off and was dropped for the wrong
     * reason. The next value to arrive that way would have been a valid address
     * turned into an invalid one and stored — a row in the queue nobody could
     * ever be sent to.
     */
    expect(normalizeContact({ email: `${"a".repeat(400)}@example.com` })).toBeNull();
    expect(normalizeContact({ phone: `+${"9".repeat(60)}` })).toBeNull();

    // And an address at the RFC's own ceiling still goes through.
    const atLimit = `${"a".repeat(242)}@example.com`;
    expect(atLimit).toHaveLength(254);
    expect(normalizeContact({ email: atLimit })?.email).toBe(atLimit);
  });
});
