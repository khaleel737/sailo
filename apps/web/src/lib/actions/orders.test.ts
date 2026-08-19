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

/** The one write allowed in front of the payment, because it can be undone. */

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
const claim = positionOf("the coupon claim", "await claimCouponRedemption(");
const invoice = positionOf("the invoice", "await createInvoiceForOrder(");
/*
 * `confirmBuyerByEmail(` without the `await`: the send moved into `after()`,
 * which runs it once the response has gone rather than making the buyer wait
 * on an HTTP call to a mail provider whose result nothing reads. Where it sits
 * in the function still matters — it must not be scheduled before the payment
 * handoff, because an email is the one thing here that cannot be recalled.
 */
const email = positionOf("the confirmation email", "confirmBuyerByEmail(");

/*
 * Spec 05's compliance gate, and the two earliest writes it has to precede.
 *
 * `upsertClient` is the first row this function creates, and `reserveStock` is
 * the first thing it takes away from anyone else.
 */
const termsGate = positionOf(
  "the terms refusal",
  "if (shop.requireTerms && !input.acceptedTerms)",
);
const clientWrite = positionOf("the client upsert", "await upsertClient(");
const stockWrite = positionOf("the stock reservation", "await reserveStock(");

describe("createOrderIntent — nothing irreversible before the payment handoff", () => {
  /*
   * The coupon is the deliberate exception, and it is only allowed to be one
   * because it has an undo.
   *
   * A usage cap has to be enforced before the buyer pays — taking money on a
   * discount that was already exhausted is worse than either failure it sits
   * between. So the redemption is claimed ahead of the handoff, and handed
   * back explicitly when the handoff fails. Both halves are asserted: a claim
   * without its release is bug 4 again, in one line.
   */
  it("claims the coupon before the buyer pays, so a spent code cannot be charged for", () => {
    expect(claim).toBeLessThan(handoff);
  });

  /*
   * The matching release is no longer asserted here, because it is no longer
   * this function's job. It used to live in the `if (!card.ok)` branch and
   * fired on that one path only, so a buyer who reached Stripe and closed the
   * tab burnt the code permanently. It now belongs to `abandonOrder`, which
   * every abandonment path calls — see inventory.test.ts, which pins that.
   */

  it("issues the invoice and the email only on rails that settle at checkout", () => {
    /*
     * The stronger rule that replaced "after the handoff".
     *
     * Moving them after the Stripe call only closed the case where Stripe's
     * API refused. A buyer who reached the payment page and closed the tab —
     * far more common — still claimed an invoice number that gapped the
     * sequence and still received an un-recallable "we have your order" for an
     * order the sweep then cancelled. On the card rail both now happen on
     * `checkout.session.completed`; every other rail keeps them here, because
     * there the order is the commitment and no webhook is coming.
     */
    expect(source).toContain("const settlesAtCheckout = method.type !== \"card\"");
    expect(source).toContain("settlesAtCheckout && !isTrialSignup\n      ? await createInvoiceForOrder(");
    expect(source).toContain("if (email && settlesAtCheckout)");
  });

  /*
   * Two orders that cost nothing, and only one of them is a sale — spec 43.
   *
   * A free order has no Checkout Session and none is coming, so it settles here
   * on every rail: deferring its invoice and its confirmation would defer them
   * for ever, leaving the buyer with a download and no receipt. A *trial*
   * signup is the exception inside the exception — nothing has been bought yet,
   * so claiming an invoice number would gap a sequence a tax authority expects
   * unbroken, on a document reading "total 0.00".
   *
   * Pinned here rather than left to a scenario because the two are one
   * character apart in the source and the difference is a tax record.
   */
  it("settles a free order here, and invoices every one of them but a trial", () => {
    expect(source).toContain("const isFreeOrder = totals.totalCents === 0");
    expect(source).toContain("method.type !== \"card\" || isFreeOrder");
    expect(source).toContain("const isTrialSignup = trial !== null");
    // And it never opens a Stripe session for one.
    expect(source).toContain("method.type === \"card\" && !isFreeOrder");
    // Nothing is owed, so nothing is outstanding — and the 24-hour sweep only
    // takes `unpaid` card orders, which is why this is not cosmetic.
    expect(source).toContain('paymentStatus: isFreeOrder ? "paid" : "unpaid"');
  });

  /*
   * The compliance refusal is in the same family as the rules above: it is
   * about where a step sits, not what it computes.
   *
   * Refusing an order after reserving its stock takes units off the shelf for
   * a sale that was never allowed to happen. No order row exists, so
   * `releaseAbandonedCheckouts` has nothing to find and nothing ever hands
   * them back — the shop reads as sold out until someone edits stock by hand.
   * The same argument covers `upsertClient`: a buyer record written for a
   * refused order is a lead the seller can neither explain nor use.
   */
  it("refuses on missing terms before it writes anything", () => {
    expect(termsGate).toBeLessThan(clientWrite);
    expect(termsGate).toBeLessThan(stockWrite);
  });

  /*
   * The proof is stamped from the server's clock and gated on the shop's own
   * column. Writing `input.acceptedTerms` into the row instead would record a
   * claim the client made about itself, which is precisely what a compliance
   * record cannot be.
   */
  it("timestamps the agreement from the server, not from the request", () => {
    expect(source).toContain("termsAcceptedAt: shop.requireTerms ? now : null");
    expect(source).not.toContain("termsAcceptedAt: input.acceptedTerms");
  });

  /*
   * Consent is only taken from a shop that asked for it. Reading the flag on
   * its own would let a hand-rolled body opt a buyer in to a shop whose
   * checkout never showed the box.
   */
  it("only records consent a shop actually asked for", () => {
    expect(source).toContain(
      "shop.askMarketingConsent && input.marketingOptIn ? now : null",
    );
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

/**
 * What the buyer is told when the action throws rather than returns.
 *
 * The panel's catch block has to give different advice per rail, and it can
 * only be right about that by knowing something this file owns: whether a
 * confirmation email has already been sent when the throw happens. Today it
 * has not on the card rail, because the send is gated on `settlesAtCheckout`.
 *
 * Flip that gate — move the card send here, say — and the panel starts telling
 * card buyers they have not been charged and should retry, when in fact an
 * email is sitting in their inbox. Nothing else would notice, so this does.
 */
describe("the failure message matches the rail", () => {
  const panel = readFileSync(
    "src/app/[handle]/_components/cart/checkout-panel.tsx",
    "utf8",
  );

  it("branches on the same rail the email is gated on", () => {
    expect(panel).toContain(
      'method === "card" ? t.checkout.failedSafe : t.checkout.failedUnsure',
    );
    // The premise: no email leaves on the card rail before payment.
    expect(source).toContain("const settlesAtCheckout = method.type !== \"card\"");
    expect(source).toContain("if (email && settlesAtCheckout)");
  });

  it("does not hard-code the message in English", () => {
    // The panel already receives a dictionary; a literal here is a storefront
    // that speaks its buyer's language until something breaks.
    expect(panel).not.toContain("Something went wrong placing your order");
  });
});
