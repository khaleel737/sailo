import { describe, expect, it } from "vitest";
import {
  isOrderStatus,
  ORDER_STATUSES,
  ORDER_STATUS_TONE,
  orderStatusTone,
} from "./order-status";

/**
 * The HQ account page carried its own copy of this map. Two copies of a
 * mapping is one that gets updated, so a status added to the list stayed
 * coloured in the seller's admin and went grey in staff HQ — visible only to
 * whoever happened to open that page.
 *
 * These pin the single copy and the behaviour callers depend on.
 */
describe("order status tones", () => {
  it("colours every status the system can store", () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_TONE[status]).toBeTruthy();
    }
  });

  it("has no tone for a status that isn't real", () => {
    expect(Object.keys(ORDER_STATUS_TONE).toSorted()).toEqual(
      [...ORDER_STATUSES].toSorted(),
    );
  });

  it("falls back to neutral rather than rendering an undefined tone", () => {
    // Status arrives from the database as `text`, so an older row or a hand
    // edit can carry something this build has never heard of.
    expect(orderStatusTone("something-new")).toBe("neutral");
    expect(orderStatusTone("")).toBe("neutral");
  });

  it("keeps the states needing action visually apart from the settled ones", () => {
    // A staff member scanning a list should not have to read the word to see
    // that an order is waiting.
    expect(orderStatusTone("confirmed")).not.toBe(orderStatusTone("completed"));
    expect(orderStatusTone("refunded")).not.toBe(orderStatusTone("completed"));
    expect(orderStatusTone("cancelled")).not.toBe(orderStatusTone("refunded"));
  });
});

describe("isOrderStatus", () => {
  it.each(ORDER_STATUSES)("accepts %s", (status) => {
    expect(isOrderStatus(status)).toBe(true);
  });

  it("rejects anything the system cannot store", () => {
    // The value arrives from a form post, so this is a trust boundary and not
    // just a typo guard.
    expect(isOrderStatus("deleted")).toBe(false);
    expect(isOrderStatus("Cancelled")).toBe(false);
    expect(isOrderStatus("")).toBe(false);
  });
});

/*
 * The "declared once" guard that used to close this file stayed behind in
 * apps/web, as `src/lib/order-status.test.ts`.
 *
 * It greps a `src` tree for hand-rolled copies of these lists, and the tree
 * worth grepping is the 100-file app where the three copies were actually
 * written — not this package, which is now the one legitimate declaration.
 * Moving it here would have pointed it at the answer instead of the problem:
 * `PAYMENT_STATUSES` does not live in this package at all, so the assertion
 * would have gone green by finding nothing.
 */
