import { describe, expect, it } from "vitest";
import { coverageOf, fullyShipped } from "./shipments";

/**
 * Coverage is what decides whether an order reads `completed`, so it is the
 * arithmetic that has to be right: an order marked finished with a box still in
 * the stockroom stops the seller chasing it and stops the buyer being told.
 */

const LINES = [
  { id: "a", title: "Speckled Mug", variantLabel: "Oatmeal", kind: "physical", quantity: 3 },
  { id: "b", title: "Tea Towel", variantLabel: null, kind: "physical", quantity: 1 },
];

describe("coverage", () => {
  it("reports nothing shipped on an order nobody has packed", () => {
    const coverage = coverageOf(LINES, new Map());
    expect(coverage.map((c) => c.remaining)).toEqual([3, 1]);
    expect(fullyShipped(coverage)).toBe(false);
  });

  it("counts a partial shipment as partial", () => {
    const coverage = coverageOf(LINES, new Map([["a", 2]]));
    expect(coverage[0]?.remaining).toBe(1);
    expect(fullyShipped(coverage)).toBe(false);
  });

  it("is complete only once every travelling line is covered", () => {
    // The second box is what finishes it — this is the assertion the scenario
    // "status moves to completed only on the second shipment" is built on.
    expect(fullyShipped(coverageOf(LINES, new Map([["a", 3]])))).toBe(false);
    expect(fullyShipped(coverageOf(LINES, new Map([["a", 3], ["b", 1]])))).toBe(true);
  });

  it("ignores lines that do not travel", () => {
    /*
     * A basket holding a mug and a PDF is fully shipped when the mug is.
     * Waiting for a download to be put in a box would leave the order
     * permanently short of `completed`, and the seller with a list that never
     * empties.
     */
    const mixed = [
      ...LINES,
      { id: "c", title: "Care guide", variantLabel: null, kind: "digital", quantity: 1 },
      { id: "d", title: "Studio hour", variantLabel: null, kind: "service", quantity: 1 },
      { id: "e", title: "Launch night", variantLabel: null, kind: "event", quantity: 2 },
    ];
    const coverage = coverageOf(mixed, new Map([["a", 3], ["b", 1]]));
    expect(coverage.map((c) => c.orderItemId)).toEqual(["a", "b"]);
    expect(fullyShipped(coverage)).toBe(true);
  });

  it("is never complete when there is nothing to ship at all", () => {
    /*
     * Deliberately false rather than vacuously true. A download-only order is
     * `completed` by being paid for, not by a fulfilment step it never had —
     * and answering true here would let a shipment write `completed` onto an
     * order with no boxes in it.
     */
    const digital = [
      { id: "c", title: "The PDF", variantLabel: null, kind: "digital", quantity: 1 },
    ];
    expect(fullyShipped(coverageOf(digital, new Map()))).toBe(false);
  });

  it("never reports a negative remainder", () => {
    // An over-ship is refused at the write, but a row that slipped past an
    // older build must not make the arithmetic go backwards.
    const coverage = coverageOf(LINES, new Map([["a", 9]]));
    expect(coverage[0]?.remaining).toBe(0);
    expect(coverage[0]?.shipped).toBe(9);
  });
});
