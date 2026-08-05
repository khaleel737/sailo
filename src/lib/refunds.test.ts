import { describe, expect, it } from "vitest";
import { canReverse, reversePayment } from "@/lib/refunds";
import type { Order } from "@/db/schema";

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
