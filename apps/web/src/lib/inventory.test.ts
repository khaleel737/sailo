import { readFileSync } from "node:fs";
import { webhookSource } from "@/lib/webhook-source";
import { describe, expect, it } from "vitest";

/**
 * The web-side halves of the stock rules.
 *
 * `inventory.ts` itself moved to `@sailo/commerce` — the mobile API changes
 * order statuses now, and the units have to move the same way whichever
 * surface the seller used. Its own tests went with it. What stays here is
 * every assertion that reads *this* app's source: the Stripe webhook, the card
 * handoff and the seller's status action are apps/web's and are not moving.
 *
 * These are pinned as source assertions rather than behaviour because each
 * rule lives in a branch or a SQL clause, not in a function anyone can call —
 * and a wrong one is silent.
 */

/**
 * A completed-but-unsettled session, and why the sweep can be trusted.
 *
 * `@sailo/commerce`'s abandoned-checkout sweep reclaims `unpaid` card orders
 * past a cutoff. That is only safe because a session that completes without
 * settling is moved off `unpaid` here. If this write is ever removed the sweep
 * silently starts cancelling Boleto and SEPA orders again — so it is pinned,
 * even though the thing it protects now lives in another package.
 */
describe("a completed-but-unsettled session", () => {
  const webhook = webhookSource();

  it("is promoted out of unpaid so the sweep passes over it", () => {
    const branch = webhook.slice(webhook.indexOf("if (!settled) {"));
    expect(branch.slice(0, branch.indexOf("return `awaiting"))).toContain(
      'paymentStatus: "pending"',
    );
  });

  it("does not treat a zero-total session as money in flight", () => {
    /*
     * `no_payment_required` is what Stripe reports when a 100%-off coupon
     * takes the basket to zero. No async_payment_* event ever follows, because
     * nothing is settling — so calling it pending stranded the order forever:
     * never confirmed, downloads never released, and exempt from the sweep
     * that would otherwise have reclaimed its stock.
     */
    const settled = webhook.slice(
      webhook.indexOf("const settled ="),
      webhook.indexOf("if (!settled) {"),
    );
    expect(settled).toContain('session.payment_status === "paid"');
    expect(settled).toContain('session.payment_status === "no_payment_required"');
  });
});

/**
 * Every path in this app that abandons an order gives back everything it holds.
 *
 * There are four, and they were not equal. All of them released the stock;
 * exactly one released the coupon — the branch that runs when Stripe's API
 * call fails, which is the rarest of the four. A buyer who reached Stripe and
 * closed the tab (the common case) had their one-use code spent forever: their
 * own retry was refused, and so was every other buyer's.
 *
 * `abandonOrder` is the single undo, and it hangs the coupon release off
 * `restoreStock`'s `restockedAt` claim so calling it twice is safe. This pins
 * the wiring, because the bug was never in the undo — it was in three call
 * sites not using it. The fourth path, the sweep, is pinned in
 * `@sailo/commerce` alongside the code it lives in.
 */
describe("the abandonment paths", () => {
  const webhooks = webhookSource();
  const handoff = readFileSync("src/lib/orders/card-handoff.ts", "utf8");

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

/**
 * Where a card order's settlement side effects actually happen.
 *
 * The invoice number and the buyer's confirmation used to be issued at
 * checkout, which on the card rail is before the buyer has paid. Moving them
 * behind the Stripe call closed only the case where Stripe's API refused; the
 * common failure — reaching the payment page and closing the tab — still burnt
 * an invoice number and still sent mail that could not be recalled, for an
 * order the sweep cancelled a day later.
 *
 * They belong where the money arrives. This pins that they are there, because
 * the checkout side only knows to skip them if this side does them.
 */
describe("settlement side effects on the paid path", () => {
  const webhook = webhookSource();
  const paid = webhook.slice(
    webhook.indexOf("await releaseDownloads(order.id);"),
    webhook.indexOf("return `order ${order.id} paid`"),
  );

  it("issues the invoice once the money has arrived", () => {
    expect(paid).toContain("createInvoiceForOrder(");
  });

  it("uses the token the success URL was built from", () => {
    // Minted before the session so the URL could name it, and carried in the
    // session metadata. A fresh token here would 404 the link the buyer holds.
    expect(paid).toContain("session.metadata?.invoiceToken");
  });

  it("tells the buyer, and only once", () => {
    expect(paid).toContain("confirmBuyerByEmail(");
    // `confirmationSentAt` is set by the checkout path on non-card rails, so
    // this must not send a second copy on a redelivered webhook.
    expect(paid).toContain("!order.confirmationSentAt");
  });
});

/**
 * Who confirms an appointment.
 *
 * Checkout tells the buyer "{shop} confirms your slot after you order", and
 * for a long time nothing did. The payment webhook flipped every `new` order
 * to `confirmed`, so a card buyer read "confirmed" about a time the seller had
 * never seen — the promise was broken by the system itself rather than by the
 * seller forgetting.
 *
 * Two halves, pinned together because either alone is wrong: payment must stop
 * confirming a booked order, and the seller's decision must reach the buyer.
 *
 * The decision email is the clearest thing apps/web still owns that the mobile
 * API does not — see the gap named on `orders.updateStatus` in `@sailo/api`.
 */
describe("a booked order waits for the seller", () => {
  const webhook = webhookSource();
  const admin = readFileSync("src/lib/actions/order-admin.ts", "utf8");

  /**
   * The seller-decision block, from the booking guard to the publish after it.
   *
   * Both boundaries have moved twice now: the stock cascade used to close the
   * slice, then the cache revalidation did, and both are now `@sailo/commerce`'s
   * — the revalidation as a callback this app hands in. What is left between
   * them is the one side effect the phone still cannot perform.
   */
  const decision = admin.slice(
    admin.indexOf("if (transition.answeredBooking)"),
    admin.indexOf("after(() => publishShopEvent"),
  );

  /**
   * Where the guard itself now lives.
   *
   * `orderTransition` decides "the seller has just answered a booking" once,
   * and both the email below and the `booking.confirmed` webhook read that one
   * answer — so the two can no longer disagree about whether a booking was
   * answered, which they could when each carried its own copy of the condition.
   */
  const commerce = readFileSync("../../packages/commerce/src/orders.ts", "utf8");

  it("does not let payment confirm an appointment", () => {
    const paid = webhook.slice(
      webhook.indexOf("// Payment is what confirms the order"),
      webhook.indexOf("await releaseDownloads(order.id);"),
    );
    // An order carrying a requested time keeps whatever status it had.
    expect(paid).toContain("!order.scheduledFor");
  });

  it("still confirms an ordinary order, so a seller need not touch it", () => {
    const paid = webhook.slice(
      webhook.indexOf("// Payment is what confirms the order"),
      webhook.indexOf("await releaseDownloads(order.id);"),
    );
    expect(paid).toContain('order.status === "new"');
    expect(paid).toContain('? "confirmed"');
  });

  it("finds the seller-decision block", () => {
    // Guards the guard: both slice boundaries are source strings, and a rename
    // on either side would otherwise empty this and pass every assertion below.
    expect(decision.length).toBeGreaterThan(0);
  });

  it("tells the buyer when the seller answers", () => {
    expect(decision).toContain("sendBookingDecision(");
    // Declining is an answer too, and the buyer needs it more than acceptance.
    expect(decision).toContain("accepted: transition.bookingAccepted");
  });

  it("does not email the same decision twice", () => {
    /*
     * Guarded on the previous status, not the new one. Re-saving an order that
     * is already confirmed must not send a second "your appointment is
     * confirmed" — the seller edits orders for all sorts of reasons.
     *
     * The condition itself is `orderTransition`'s now, so it is asserted at its
     * new address. Nothing is given up by following it there: the same string
     * decides the email and the `booking.confirmed` webhook, where before this
     * action spelled it out twice and could have been changed in one place.
     */
    expect(commerce).toContain('previous.status === "new"');
    expect(commerce).toContain("answeredBooking");
  });

  it("reads that decision rather than re-deriving it", () => {
    /*
     * The point of the previous assertion. A branch here that re-tested
     * `previous.scheduledFor && previous.status === "new"` by hand would pass
     * every test in this file and still be a second copy of the rule — the kind
     * that stays right until the day one of the two is edited.
     */
    expect(decision).toContain("transition.answeredBooking");
    expect(decision).not.toContain("previous.scheduledFor");
  });
});
