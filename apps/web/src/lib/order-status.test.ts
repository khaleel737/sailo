import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The status lists are declared once, and not in this app.
 *
 * Three copies of the order list had been written by hand — the seller's status
 * action and the /hq order filter each declared their own `Set`, and the /hq
 * payment one had already drifted to three of the five statuses, so filtering
 * staff HQ by `refunded` or `disputed` quietly matched everything instead.
 * Copies of a list are copies that diverge, and nothing fails when they do.
 *
 * `ORDER_STATUSES` now lives in `@sailo/core/order-status`, because the mobile
 * app needs the same list to validate the same status change. So the assertion
 * flipped: this app must declare *no* copy of it. The behavioural tests moved
 * with the code and live in `packages/core/src/order-status.test.ts`; what
 * stays here is the grep, because this is the tree the copies were written in.
 *
 * `PAYMENT_STATUSES` has not moved — nothing outside apps/web sets a payment
 * status — so it is still pinned to its one module here.
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

  it("declares no copy of ORDER_STATUSES — it comes from @sailo/core", () => {
    expect(declarations("ORDER_STATUSES")).toEqual([]);
  });

  it("declares PAYMENT_STATUSES only in payments/status.ts", () => {
    expect(declarations("PAYMENT_STATUSES")).toEqual([
      "src/lib/payments/status.ts",
    ]);
  });

  /*
   * And the import is real. Without this, deleting the last `@sailo/core`
   * import would leave the assertion above green — "no copy declared" is also
   * true of an app that stopped using the list at all, and the point is that
   * this app uses the shared one.
   */
  it("reads the shared list rather than doing without it", () => {
    const importers = execSync(
      `grep -rln "@sailo/core/order-status" src --include="*.ts" --include="*.tsx" || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.endsWith(".test.ts"));
    expect(importers.length).toBeGreaterThan(0);
  });
});
