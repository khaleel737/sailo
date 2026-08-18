import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { taxFromSession } from "./tax";

/**
 * Reading back what Stripe Tax actually charged.
 *
 * Every number here lands on an order that has already been paid and on the
 * invoice issued from it, so a mistake is not a bad quote — it is a document
 * that disagrees with a card statement, discovered by a buyer or an auditor.
 *
 * The case that matters most is the last one: a zero-tax sale has three
 * different causes and only one of them is a reverse charge.
 */

const session = (over: Partial<Stripe.Checkout.Session> = {}) =>
  ({
    amount_total: 12_000,
    total_details: { amount_tax: 2000, amount_discount: 0, amount_shipping: 0 },
    customer_details: { tax_ids: [] },
    ...over,
  }) as unknown as Stripe.Checkout.Session;

describe("taxFromSession", () => {
  it("reads the amounts Stripe settled", () => {
    const tax = taxFromSession(session());
    expect(tax?.taxCents).toBe(2000);
    expect(tax?.totalCents).toBe(12_000);
  });

  it("back-computes the rate from the amounts", () => {
    // £100 net + £20 tax is 20%, which is what the invoice has to print.
    expect(taxFromSession(session())?.taxRateBp).toBe(2000);
  });

  it("expresses a blended rate as what was actually charged", () => {
    /*
     * Two line items in different tax categories, or shipping taxed at a
     * different rate from the goods. Stripe reports amounts and never a
     * percentage, so there is no single "the rate" to read — this is the one
     * number that is true of the order as a whole.
     */
    const tax = taxFromSession(
      session({
        amount_total: 11_000,
        total_details: { amount_tax: 1000 } as Stripe.Checkout.Session.TotalDetails,
      }),
    );
    expect(tax?.taxRateBp).toBe(1000);
  });

  it("does not divide by zero on a fully discounted order", () => {
    const tax = taxFromSession(
      session({
        amount_total: 0,
        total_details: { amount_tax: 0 } as Stripe.Checkout.Session.TotalDetails,
      }),
    );
    expect(tax?.taxRateBp).toBe(0);
  });

  it("returns null when Stripe computed no tax at all", () => {
    /*
     * A manual-mode session. Null rather than a zeroed object, so the caller
     * leaves the order's own snapshot alone instead of overwriting a flat-rate
     * order with zeros.
     */
    expect(taxFromSession(session({ total_details: null }))).toBeNull();
  });

  it("carries the buyer's tax id and its type", () => {
    const tax = taxFromSession(
      session({
        customer_details: {
          tax_ids: [{ type: "eu_vat", value: "DE123456789" }],
        } as Stripe.Checkout.Session.CustomerDetails,
      }),
    );
    expect(tax?.buyerTaxId).toBe("DE123456789");
    expect(tax?.buyerTaxIdType).toBe("eu_vat");
  });

  it("ignores a tax id Stripe could not resolve to a value", () => {
    // Stripe returns the entry with a null value when the buyer typed
    // something it would not accept. Printing that on an invoice as though it
    // were a validated number is worse than printing nothing.
    const tax = taxFromSession(
      session({
        customer_details: {
          tax_ids: [{ type: "eu_vat", value: null }],
        } as Stripe.Checkout.Session.CustomerDetails,
      }),
    );
    expect(tax?.buyerTaxId).toBeNull();
    expect(tax?.reverseCharge).toBe(false);
  });

  describe("reverse charge", () => {
    it("is a valid tax id and no tax together", () => {
      const tax = taxFromSession(
        session({
          amount_total: 10_000,
          total_details: { amount_tax: 0 } as Stripe.Checkout.Session.TotalDetails,
          customer_details: {
            tax_ids: [{ type: "eu_vat", value: "IE6388047V" }],
          } as Stripe.Checkout.Session.CustomerDetails,
        }),
      );
      expect(tax?.reverseCharge).toBe(true);
    });

    it("is not a consumer sale that simply carried no tax", () => {
      /*
       * The distinction the whole flag exists for. This order also has
       * `taxCents: 0` — a shop below a threshold, or a zero-rated product —
       * and an invoice claiming the recipient will account for VAT would be
       * false, on a document a tax authority may read.
       */
      const tax = taxFromSession(
        session({
          amount_total: 10_000,
          total_details: { amount_tax: 0 } as Stripe.Checkout.Session.TotalDetails,
        }),
      );
      expect(tax?.reverseCharge).toBe(false);
    });

    it("is not a domestic B2B sale, which carries a number and tax", () => {
      // A German seller invoicing a German company charges VAT as normal. The
      // number is present; the exemption is not.
      const tax = taxFromSession(
        session({
          customer_details: {
            tax_ids: [{ type: "eu_vat", value: "DE123456789" }],
          } as Stripe.Checkout.Session.CustomerDetails,
        }),
      );
      expect(tax?.reverseCharge).toBe(false);
    });
  });
});
