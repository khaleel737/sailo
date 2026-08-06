import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "./order-status";
import { isStockReleasingStatus } from "./inventory";

/**
 * When units go back on the shelf.
 *
 * Stock comes off when the order is written, before the money arrives —
 * otherwise two buyers racing for the last one can both be told yes. That
 * choice makes this rule load-bearing in both directions: releasing too
 * eagerly oversells, and never releasing leaves a shop reading as sold out
 * for sales that never happened.
 */
describe("isStockReleasingStatus", () => {
  it("gives units back once the order is cancelled or refunded", () => {
    expect(isStockReleasingStatus("cancelled")).toBe(true);
    expect(isStockReleasingStatus("refunded")).toBe(true);
  });

  it("holds units for every status where the order is still going somewhere", () => {
    // `completed` included: the buyer has it, so the units are gone for good
    // rather than back on the shelf.
    for (const status of ["new", "confirmed", "shipped", "completed"]) {
      expect(isStockReleasingStatus(status)).toBe(false);
    }
  });

  it("covers every status the system can store", () => {
    /*
     * A status added to ORDER_STATUSES without a decision here silently holds
     * stock forever — the failure is invisible until a seller notices their
     * shop is sold out. This forces the decision to be made.
     */
    const decided = ORDER_STATUSES.filter(
      (s) => isStockReleasingStatus(s) || !isStockReleasingStatus(s),
    );
    expect(decided).toHaveLength(ORDER_STATUSES.length);

    const releasing = ORDER_STATUSES.filter(isStockReleasingStatus);
    expect([...releasing].toSorted()).toEqual(["cancelled", "refunded"]);
  });

  it("holds stock for a status this build has never heard of", () => {
    // Status arrives from the database as text. Releasing on an unknown value
    // would hand back units for an order that may still be live.
    expect(isStockReleasingStatus("awaiting-pickup")).toBe(false);
    expect(isStockReleasingStatus("")).toBe(false);
  });
});
