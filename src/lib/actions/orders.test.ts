import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What `createOrderIntent` is allowed to do before the payment can still fail.
 *
 * The order used to be: items, coupon redemption, invoice, confirmation email,
 * *then* Stripe. When Stripe refused the handoff, `card-handoff.ts` deleted the
 * order and put the stock back — the only two things a rollback can reach. The
 * buyer was left holding an email saying their order was confirmed, linking to
 * an invoice that had just been deleted; the coupon they used was spent; and
 * the invoice numbering had a gap in a sequence tax authorities expect to be
 * unbroken.
 *
 * These are source-order assertions rather than behavioural ones on purpose.
 * The rule being protected is "the irreversible steps come last", which is a
 * property of the sequence itself, and a unit test of any single step cannot
 * see it. `dependencies.test.ts` guards a structural invariant the same way.
 */

const source = readFileSync("src/lib/actions/orders.ts", "utf8");

/** Where a step happens in `createOrderIntent`, failing loudly if it moved. */
function positionOf(label: string, needle: string): number {
  const at = source.indexOf(needle);
  if (at === -1) {
    throw new Error(
      `${label} not found in orders.ts — this test pins call order and the ` +
        `anchor "${needle}" no longer matches. Re-anchor it rather than deleting it.`,
    );
  }
  return at;
}

const handoff = positionOf("the Stripe handoff", "await handOffToStripe(");
const coupon = positionOf("the coupon redemption", "${coupons.timesRedeemed} + 1");
const invoice = positionOf("the invoice", "await createInvoiceForOrder(");
const email = positionOf("the confirmation email", "await sendOrderConfirmation(");

describe("createOrderIntent — nothing irreversible before the payment handoff", () => {
  it("hands off to Stripe before spending the buyer's coupon", () => {
    // A redemption counted against an order that then gets deleted is a
    // discount the buyer paid for and can never use again.
    expect(handoff).toBeLessThan(coupon);
  });

  it("hands off to Stripe before claiming an invoice number", () => {
    // Numbers are claimed from a per-shop sequence. One claimed for an order
    // that is then rolled back leaves a hole no later invoice fills.
    expect(handoff).toBeLessThan(invoice);
  });

  it("hands off to Stripe before telling the buyer the order is confirmed", () => {
    // The one step with no rollback at all: mail that has left cannot be
    // recalled, and it names an invoice the rollback deletes.
    expect(handoff).toBeLessThan(email);
  });
});
