import { execSync } from "node:child_process";
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

/**
 * The list itself lives in exactly one module.
 *
 * Three copies of this had been written by hand — the seller's status action
 * and the /hq order filter each declared their own `Set`, and the /hq payment
 * one had already drifted to three of the five statuses, so filtering staff HQ
 * by `refunded` or `disputed` quietly matched everything instead. Copies of a
 * list are copies that diverge, and nothing fails when they do.
 */
describe("the status lists are declared once", () => {
  const declarations = (name: string) =>
    execSync(
      `grep -rln "const ${name} = " src --include="*.ts" --include="*.tsx" || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.endsWith(".test.ts"));

  it("declares ORDER_STATUSES only in order-status.ts", () => {
    expect(declarations("ORDER_STATUSES")).toEqual(["src/lib/order-status.ts"]);
  });

  it("declares PAYMENT_STATUSES only in payments/status.ts", () => {
    expect(declarations("PAYMENT_STATUSES")).toEqual([
      "src/lib/payments/status.ts",
    ]);
  });
});
