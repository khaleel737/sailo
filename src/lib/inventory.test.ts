import { readFileSync } from "node:fs";
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

/**
 * Which orders the abandoned-checkout sweep is allowed to reclaim.
 *
 * Stock comes off the shelf before the money arrives, so something has to put
 * it back when the buyer never pays. Getting the predicate wrong is expensive
 * in both directions, and it was wrong in both:
 *
 * - It required `stripeSessionId`, which is only written once Stripe accepts
 *   the handoff. An order that reserved stock and threw before that write was
 *   invisible to this sweep forever, and nothing else reclaims it.
 * - It matched every `unpaid` order with a session, which includes a delayed
 *   method still settling. Boleto takes three days; those orders were
 *   cancelled and restocked with the buyer's money still in flight.
 *
 * Asserted against the source because the rule lives in a SQL WHERE clause —
 * there is no pure function to call, and a wrong clause here is silent.
 */
describe("the abandoned-checkout predicate", () => {
  const source = readFileSync("src/lib/inventory.ts", "utf8");
  const sweep = source.slice(source.indexOf("const stale = await"));
  /*
   * Comments stripped first. The prose here explains what the predicate no
   * longer does, and naming a removed clause in a comment would otherwise read
   * as the clause still being present — which is exactly what happened the
   * first time this was written.
   */
  const predicate = sweep
    .slice(0, sweep.indexOf("limit: 200"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("reclaims only orders whose money never arrived", () => {
    expect(predicate).toContain('eq(orders.paymentStatus, "unpaid")');
  });

  it("leaves a delayed payment that is still settling alone", () => {
    /*
     * `pending` is what the webhook promotes a completed-but-unsettled session
     * to, and it is the only thing separating "the money is on its way" from
     * "the buyer walked away". Sweeping it would cancel a paid-for order.
     */
    expect(predicate).not.toContain('"pending"');
  });

  it("finds an order that never reached the Stripe handoff", () => {
    // The session id is written after the handoff, so requiring it here meant
    // the orders most in need of reclaiming were the ones it could not see.
    expect(predicate).not.toContain("stripeSessionId");
  });

  it("matches on the rail, so bank transfer and cash on delivery are safe", () => {
    // Those are unpaid because the seller is waiting for money, not because
    // the buyer abandoned anything. Cancelling them would destroy real orders.
    expect(predicate).toContain('eq(orders.paymentMethod, "card")');
  });

  it("never restocks the same order twice", () => {
    expect(predicate).toContain("isNull(orders.restockedAt)");
  });

  it("only touches orders older than the cutoff", () => {
    expect(predicate).toContain("lt(orders.createdAt, cutoff)");
  });
});

/**
 * The other half of that pair, in the webhook.
 *
 * The sweep above is only safe because a session that completes unpaid is
 * moved off `unpaid`. If that write is ever removed, the sweep silently starts
 * cancelling Boleto and SEPA orders again — so it is pinned here, next to the
 * predicate that depends on it, rather than in a file nobody reads together.
 */
describe("a completed-but-unsettled session", () => {
  const webhook = readFileSync("src/lib/stripe-webhooks.ts", "utf8");

  it("is promoted out of unpaid so the sweep passes over it", () => {
    const branch = webhook.slice(
      webhook.indexOf('if (session.payment_status !== "paid")'),
    );
    expect(branch.slice(0, branch.indexOf("return `awaiting"))).toContain(
      'paymentStatus: "pending"',
    );
  });
});

/**
 * Every path that abandons an order gives back everything it holds.
 *
 * There are four, and they were not equal. All of them released the stock;
 * exactly one released the coupon — the branch that runs when Stripe's API
 * call fails, which is the rarest of the four. A buyer who reached Stripe and
 * closed the tab (the common case) had their one-use code spent forever: their
 * own retry was refused, and so was every other buyer's.
 *
 * `abandonOrder` is now the single undo, and it hangs the coupon release off
 * `restoreStock`'s `restockedAt` claim so calling it twice is safe. This pins
 * the wiring, because the bug was never in the undo — it was in three call
 * sites not using it.
 */
describe("the abandonment paths", () => {
  const webhooks = readFileSync("src/lib/stripe-webhooks.ts", "utf8");
  const handoff = readFileSync("src/lib/orders/card-handoff.ts", "utf8");
  const sweep = readFileSync("src/lib/inventory.ts", "utf8");

  /** A handler's body, from its `case` label to the next one. */
  function branch(source: string, label: string): string {
    const from = source.indexOf(`case "${label}"`);
    expect(from, `${label} handler not found`).toBeGreaterThan(-1);
    const next = source.indexOf("\n    case ", from + 1);
    return source.slice(from, next === -1 ? undefined : next);
  }

  it.each(["checkout.session.expired", "checkout.session.async_payment_failed"])(
    "%s gives back the coupon as well as the stock",
    (event) => {
      const body = branch(webhooks, event);
      expect(body).toContain("abandonOrder(order)");
      expect(body).not.toContain("restoreStock(order)");
    },
  );

  it("a failed Stripe handoff gives back the coupon as well as the stock", () => {
    expect(handoff).toContain("abandonOrder(saved)");
    expect(handoff).not.toContain("restoreStock(saved)");
  });

  it("the abandoned-checkout sweep gives back the coupon as well as the stock", () => {
    const body = sweep.slice(sweep.indexOf("const orderIds"));
    expect(body).toContain("abandonOrder(order)");
  });

  it("still only restores stock when a paid order reverses", () => {
    /*
     * A lost chargeback is not an abandonment: the buyer did use the coupon,
     * and the money leaving afterwards does not give that use back. It stays
     * on `restoreStock` deliberately.
     */
    const body = branch(webhooks, "charge.dispute.closed");
    expect(body).toContain("restoreStock(order)");
    expect(body).not.toContain("abandonOrder(");
  });
});
