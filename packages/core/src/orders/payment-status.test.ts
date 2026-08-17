import { describe, expect, it } from "vitest";
import {
  awaitsTransfer,
  checkPaymentReference,
  isPaymentStatus,
  isSellerSettablePaymentStatus,
  PAYMENT_STATUS_TONES,
  PAYMENT_STATUSES,
  SELLER_SETTABLE_PAYMENT_STATUSES,
  TRANSFERABLE_PAYMENT_STATUSES,
} from "./payment-status";

/**
 * Who may move an order's money, and from where.
 *
 * `submitPaymentReference` is public and unauthenticated — it is how a buyer
 * paying by bank transfer says "I've sent it", and it identifies the order by
 * id alone. Its guard used to be `paymentStatus === "paid"`, which let anyone
 * holding an order id move a *disputed* order to "pending": a chargeback had
 * already taken the money out of the seller's balance, and the seller's list
 * would show a sale awaiting confirmation instead of one they had lost.
 */

const order = (paymentStatus: string) => ({ paymentStatus });

describe("checkPaymentReference", () => {
  it("accepts a reference on an order still waiting for the money", () => {
    expect(checkPaymentReference(order("unpaid"), "TRF-99")).toEqual({
      ok: true,
      reference: "TRF-99",
    });
  });

  it("accepts a second reference on an order already marked pending", () => {
    // A buyer correcting a typo in what they sent the first time.
    expect(checkPaymentReference(order("pending"), "TRF-100").ok).toBe(true);
  });

  it("refuses to touch a disputed order", () => {
    /*
     * The bug. A chargeback is a fact the bank reported; moving it to
     * "pending" would hide a reversal behind a status that looks like
     * progress.
     */
    const result = checkPaymentReference(order("disputed"), "TRF-99");
    expect(result.ok).toBe(false);
  });

  it("refuses to touch a refunded order", () => {
    expect(checkPaymentReference(order("refunded"), "TRF-99").ok).toBe(false);
  });

  it("refuses to touch a paid order", () => {
    expect(checkPaymentReference(order("paid"), "TRF-99").ok).toBe(false);
  });

  it("does not name the status it refused", () => {
    // The caller proved they know an order id, not that they are the buyer.
    const result = checkPaymentReference(order("disputed"), "TRF-99");
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).not.toMatch(/disput/i);
  });

  it("trims the reference and returns what it checked", () => {
    // The caller writes this value, so it must not re-derive and drift.
    expect(checkPaymentReference(order("unpaid"), "  TRF-99  ")).toEqual({
      ok: true,
      reference: "TRF-99",
    });
  });

  it("caps a reference at 200 characters", () => {
    const result = checkPaymentReference(order("unpaid"), "x".repeat(500));
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.reference).toHaveLength(200);
  });

  it.each(["", "   ", "\n\t"])("rejects a blank reference (%j)", (raw) => {
    expect(checkPaymentReference(order("unpaid"), raw).ok).toBe(false);
  });

  it("rejects a blank reference before considering the status", () => {
    // Both are refusals, but the buyer can act on "add the reference".
    const result = checkPaymentReference(order("unpaid"), "  ");
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toMatch(/reference/i);
  });
});

describe("the status lists agree with each other", () => {
  it("never lets a stranger act where the shop's own owner may not", () => {
    /*
     * The invariant behind the bug: an anonymous caller must not reach a
     * status the authenticated owner is deliberately forbidden to set. If a
     * status is ever added to TRANSFERABLE_PAYMENT_STATUSES that the seller
     * cannot set by hand, this fails and asks why.
     */
    for (const status of TRANSFERABLE_PAYMENT_STATUSES) {
      expect(isSellerSettablePaymentStatus(status)).toBe(true);
    }
  });

  it("keeps disputed out of everything a human can set", () => {
    expect(isSellerSettablePaymentStatus("disputed")).toBe(false);
    expect(awaitsTransfer("disputed")).toBe(false);
  });

  it.each(PAYMENT_STATUSES)("recognises %s as a status", (status) => {
    expect(isPaymentStatus(status)).toBe(true);
  });

  it("does not recognise a status that isn't one", () => {
    expect(isPaymentStatus("chargeback")).toBe(false);
    expect(isPaymentStatus("")).toBe(false);
  });

  it("gives every status a tone, so none renders as whatever is first", () => {
    // A status the UI doesn't know about once displayed as "Unpaid".
    for (const status of PAYMENT_STATUSES) {
      expect(PAYMENT_STATUS_TONES[status]).toBeTruthy();
    }
  });

  it("draws every settable and transferable status from the real list", () => {
    for (const status of [
      ...SELLER_SETTABLE_PAYMENT_STATUSES,
      ...TRANSFERABLE_PAYMENT_STATUSES,
    ]) {
      expect(PAYMENT_STATUSES).toContain(status);
    }
  });
});
