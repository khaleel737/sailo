import { describe, expect, it } from "vitest";
import { canReverse, checkRefund, refundableCents, reversePayment } from "./refunds";
import type { Order } from "@sailo/db/schema";

/**
 * Which rail gets asked to give the money back.
 *
 * Only the decision is covered here — the card branch's Stripe call is proven
 * against real charges by `npm run check:cards`. What matters at this level is
 * that a rail we cannot reverse is never mistaken for one we can, because the
 * two produce opposite instructions to the seller: "we sent it back" against
 * "send it back yourself".
 */
const order = (over: Partial<Order> = {}): Order =>
  ({
    id: "order_1",
    paymentMethod: "card",
    stripePaymentIntentId: "pi_123",
    stripeAccountId: "acct_123",
    totalCents: 4800,
    ...over,
  }) as Order;

describe("canReverse", () => {
  it("knows card can give money back on its own", () => {
    expect(canReverse(order({ paymentMethod: "card" }))).toBe(true);
  });

  it("knows the rest cannot", () => {
    for (const rail of [
      "whatsapp",
      "telegram",
      "instagram",
      "email",
      "phone",
      "bank_transfer",
      "cod",
    ]) {
      expect(canReverse(order({ paymentMethod: rail }))).toBe(false);
    }
  });

  it("treats an unrecognised rail as one we cannot reverse", () => {
    expect(canReverse(order({ paymentMethod: "carrier-pigeon" }))).toBe(false);
  });
});

describe("reversePayment", () => {
  it("hands a chat rail back to the seller to settle", async () => {
    await expect(
      reversePayment(order({ paymentMethod: "whatsapp" }), 4800),
    ).resolves.toEqual({ kind: "manual", reason: "off_platform" });
  });

  it("hands bank transfer and cash on delivery back too", async () => {
    for (const rail of ["bank_transfer", "cod"]) {
      await expect(
        reversePayment(order({ paymentMethod: rail }), 4800),
      ).resolves.toEqual({ kind: "manual", reason: "off_platform" });
    }
  });

  /*
   * A card order that never reached Stripe — the buyer chose card and
   * abandoned the checkout. There is no charge to reverse, and saying we sent
   * money back would be a lie told to the one person who could correct it.
   */
  it("does not claim to reverse a card order that was never charged", async () => {
    await expect(
      reversePayment(
        order({ paymentMethod: "card", stripePaymentIntentId: null }),
        4800,
      ),
    ).resolves.toEqual({ kind: "manual", reason: "never_charged" });

    await expect(
      reversePayment(
        order({ paymentMethod: "card", stripeAccountId: null }),
        4800,
      ),
    ).resolves.toEqual({ kind: "manual", reason: "never_charged" });
  });

  it("treats an unknown rail as settled off-platform rather than guessing", async () => {
    await expect(
      reversePayment(order({ paymentMethod: "" }), 4800),
    ).resolves.toEqual({ kind: "manual", reason: "off_platform" });
  });
});

/**
 * How much of an order is still refundable.
 *
 * The guard used to compare a request against the order total and the write
 * used to assign rather than accumulate. A seller refunding $50 of a $100
 * order twice moved $100 at the processor — each half sits inside the
 * original charge, so nothing rejects it — while the column still read $50.
 * Revenue, the dashboard and both CSV exports then under-report by half, with
 * no screen showing the gap.
 */
describe("checkRefund", () => {
  // Named apart from the module-level `order` factory: this one describes
  // only the two columns the refund arithmetic reads, not a whole Order.
  const refundable = (totalCents: number, refundedCents = 0) => ({
    totalCents,
    refundedCents,
  });

  it("allows a first refund up to the total", () => {
    const check = checkRefund(refundable(10_000), 10_000);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.refundedTotal).toBe(10_000);
      expect(check.isFull).toBe(true);
    }
  });

  it("accumulates rather than overwrites", () => {
    const check = checkRefund(refundable(10_000, 5_000), 5_000);
    expect(check.ok).toBe(true);
    // The bug: this used to record 5,000 after 10,000 had been moved.
    if (check.ok) expect(check.refundedTotal).toBe(10_000);
  });

  it("refuses a second refund that exceeds what is left", () => {
    const check = checkRefund(refundable(10_000, 5_000), 6_000);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("exceeds_remaining");
      expect(check.remaining).toBe(5_000);
    }
  });

  it("refuses anything once the order is fully refunded", () => {
    const check = checkRefund(refundable(10_000, 10_000), 1);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.remaining).toBe(0);
  });

  it("counts two halves as a full refund", () => {
    // Status must become "refunded" whether it took one refund or two.
    const check = checkRefund(refundable(10_000, 5_000), 5_000);
    if (check.ok) expect(check.isFull).toBe(true);
  });

  it("leaves a partial refund partial", () => {
    const check = checkRefund(refundable(10_000), 2_500);
    if (check.ok) expect(check.isFull).toBe(false);
  });

  it("refuses zero and negative amounts", () => {
    expect(checkRefund(refundable(10_000), 0).ok).toBe(false);
    expect(checkRefund(refundable(10_000), -500).ok).toBe(false);
  });

  it("never reports a negative remaining", () => {
    // An over-refund recorded by an older build must not invert the ceiling.
    expect(refundableCents(refundable(10_000, 12_000))).toBe(0);
  });
});
