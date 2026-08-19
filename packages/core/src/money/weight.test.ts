import { describe, expect, it } from "vitest";
import {
  bandFor,
  basketWeightGrams,
  formatGrams,
  usableBands,
  weightedRate,
} from "./weight";

/**
 * Weight bands decide what a buyer is charged for postage, so the boundaries
 * are the whole test: one gram either side of a band edge is a different price,
 * and the seller reads the difference on a carrier invoice a week later.
 */

const BANDS = [
  { upToGrams: 500, priceCents: 350 },
  { upToGrams: 2000, priceCents: 595 },
  { upToGrams: 10_000, priceCents: 1250 },
];

describe("what the basket weighs", () => {
  it("multiplies each line by its quantity", () => {
    expect(
      basketWeightGrams([
        { weightGrams: 250, quantity: 2 },
        { weightGrams: 100, quantity: 3 },
      ]),
    ).toBe(800);
  });

  it("counts an unweighed line as nothing", () => {
    /*
     * The deliberate reading of a genuinely ambiguous state. A seller who
     * switches a rate to `by_weight` before weighing anything lands every
     * basket in their cheapest band — visible on their own screen, undercharges
     * them rather than the buyer, and is fixed by typing a number. Refusing to
     * quote would take their shipping down the moment the mode changed.
     */
    expect(
      basketWeightGrams([
        { weightGrams: null, quantity: 4 },
        { quantity: 1 },
        { weightGrams: 300, quantity: 1 },
      ]),
    ).toBe(300);
  });

  it("ignores nonsense rather than propagating it", () => {
    // A NaN weight would make the whole basket NaN, and `NaN <= 500` is false,
    // so every rate would silently withdraw.
    expect(
      basketWeightGrams([
        { weightGrams: Number.NaN, quantity: 1 },
        { weightGrams: -900, quantity: 1 },
        { weightGrams: Number.POSITIVE_INFINITY, quantity: 1 },
        { weightGrams: 400, quantity: 1 },
      ]),
    ).toBe(400);
  });

  it("weighs an empty basket as nothing", () => {
    expect(basketWeightGrams([])).toBe(0);
  });
});

describe("the band a parcel falls in", () => {
  it("takes the exact boundary as inside the band, not above it", () => {
    // Sellers write their tables as "up to 500 g". Charging the next band up
    // for exactly 500 g is the version a buyer notices.
    expect(bandFor(BANDS, 500)?.priceCents).toBe(350);
    expect(bandFor(BANDS, 501)?.priceCents).toBe(595);
    expect(bandFor(BANDS, 2000)?.priceCents).toBe(595);
    expect(bandFor(BANDS, 2001)?.priceCents).toBe(1250);
  });

  it("takes the cheapest band for a weightless basket", () => {
    expect(bandFor(BANDS, 0)?.priceCents).toBe(350);
  });

  it("answers nothing above the heaviest band", () => {
    expect(bandFor(BANDS, 10_001)).toBeNull();
  });

  it("reads a table the seller typed out of order", () => {
    // The row is edited by dragging fields around. A table read in the stored
    // order would charge the 5 kg price for a 500 g parcel.
    const jumbled = [
      { upToGrams: 10_000, priceCents: 1250 },
      { upToGrams: 500, priceCents: 350 },
      { upToGrams: 2000, priceCents: 595 },
    ];
    expect(bandFor(jumbled, 400)?.priceCents).toBe(350);
  });

  it("drops rows that are not bands rather than repairing them", () => {
    const messy = [
      { upToGrams: 0, priceCents: 100 },
      { upToGrams: -5, priceCents: 100 },
      { upToGrams: 500, priceCents: -1 },
      { upToGrams: Number.NaN, priceCents: 100 },
      { upToGrams: 1000, priceCents: 400 },
    ];
    expect(usableBands(messy)).toEqual([{ upToGrams: 1000, priceCents: 400 }]);
  });

  it("survives a column holding something that is not a list", () => {
    // jsonb hands back whatever was written, including by a build that no
    // longer exists.
    expect(usableBands(null)).toEqual([]);
    expect(usableBands(undefined)).toEqual([]);
    expect(usableBands("nonsense" as never)).toEqual([]);
  });
});

describe("what a rate charges", () => {
  const flat = { rateMode: "flat", weightBands: BANDS, feeCents: 499 };
  const byWeight = { rateMode: "by_weight", weightBands: BANDS, feeCents: 499 };

  it("ignores the table entirely on a flat rate", () => {
    // Every rate saved before spec 51 is `flat`, and none of them changes.
    expect(weightedRate(flat, 9000)).toEqual({ ok: true, feeCents: 499 });
  });

  it("charges the band on a weighted rate", () => {
    expect(weightedRate(byWeight, 400)).toEqual({ ok: true, feeCents: 350 });
    expect(weightedRate(byWeight, 3000)).toEqual({ ok: true, feeCents: 1250 });
  });

  it("withdraws rather than undercharging above the heaviest band", () => {
    // Falling back to the top price is the seller paying the difference on
    // every oversized parcel, silently.
    expect(weightedRate(byWeight, 12_000)).toEqual({
      ok: false,
      reason: "over_max_weight",
      maxGrams: 10_000,
    });
  });

  it("falls back to the flat fee while the table is still empty", () => {
    /*
     * The half-configured state a seller passes through between flipping the
     * switch and typing the table. Taking their shipping down for the minute in
     * between is a worse answer than charging the flat price they had a moment
     * ago.
     */
    expect(weightedRate({ ...byWeight, weightBands: [] }, 9000)).toEqual({
      ok: true,
      feeCents: 499,
    });
  });

  it("treats an unset mode as flat", () => {
    expect(weightedRate({ weightBands: BANDS, feeCents: 499 }, 9000)).toEqual({
      ok: true,
      feeCents: 499,
    });
  });
});

describe("what a person reads", () => {
  it("switches to kilograms once there are enough grams for it", () => {
    expect(formatGrams(450)).toMatch(/450/);
    expect(formatGrams(2500)).toMatch(/2\.5/);
  });

  it("never throws on a language tag it does not know", () => {
    // The locale reaches this from a device setting, not from us.
    expect(() => formatGrams(1200, "not-a-locale")).not.toThrow();
  });
});
