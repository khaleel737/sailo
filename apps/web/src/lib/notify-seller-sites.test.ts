import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * "Exactly one seller email per order", pinned at both send sites.
 *
 * There are two places an order can settle — `createOrderIntent` for every
 * rail that settles at checkout, and the Connect webhook when a card payment
 * lands — and the bug this guards is the easy one: adding the seller's email
 * to both without the discriminator, so a card sale mails twice and a manual
 * sale mails once. The buyer's confirmation already solved this, and the
 * seller's copy has to ride the *same* discriminator or the two drift.
 *
 * Source assertions, like `orders.test.ts` above them: neither send site is
 * reachable without a database, a mail provider and Stripe, and what is being
 * protected is which branch each one sits in.
 */

const orders = readFileSync("src/lib/actions/orders.ts", "utf8");
const connect = readFileSync("src/lib/stripe-webhooks/connect.ts", "utf8");
/*
 * `notifySellerOfOrder` moved to `@sailo/commerce/orders` — the phone settles
 * orders too, and a seller notice that only fires from the website is a seller
 * who finds out about half their sales. This test stayed here because the two
 * *send sites* it pins are both this app's, and what it guards is which branch
 * each one sits in rather than anything about the function itself.
 */
const notify = readFileSync(
  createRequire(import.meta.url).resolve("@sailo/commerce/orders").replace(/index\.ts$/, "notify-seller.ts"),
  "utf8",
);
const reference = readFileSync("src/lib/actions/payment-reference.ts", "utf8");

describe("exactly one of the two send sites fires per order", () => {
  it("sends from checkout only on the rails that settle there", () => {
    /*
     * The same `settlesAtCheckout` the buyer's confirmation uses, so the two
     * emails can never disagree about which rail this order was on.
     */
    expect(orders).toContain("const settlesAtCheckout = method.type !== \"card\"");
    expect(orders).toContain(
      "if (settlesAtCheckout) {\n    after(() => notifySellerOfOrder({ shop, orderId: order.id }));",
    );
  });

  it("sends from the webhook only when the payment settles", () => {
    // Inside the settled branch — the `!settled` path returns before this.
    const settled = connect.indexOf("const settled =");
    const send = connect.indexOf("await notifySellerOfOrder(");
    expect(send).toBeGreaterThan(settled);
  });

  it("does not re-send when a settled order is seen again", () => {
    /*
     * Stripe's event-id claim already makes each *event* once-only, but a
     * second settling event for the same order — `checkout.session.completed`
     * followed by an `async_payment_succeeded` — is a different event id and
     * would reach here twice. The pre-update status read is what stops it.
     */
    expect(connect).toContain('if (order.paymentStatus !== "paid") {');
  });
});

describe("a notification never costs an order", () => {
  it("runs off the request's critical path at checkout", () => {
    // `after()`, so the buyer is not waiting on a mail provider.
    expect(orders).toContain("after(() => notifySellerOfOrder(");
  });

  it("swallows and logs its own failures", () => {
    /*
     * The webhook awaits this inline — `after()` is not available in the same
     * sense there — so a throw would become a non-2xx, and Stripe would retry
     * a payment that has already been recorded. Every entry point is wrapped.
     */
    /*
     * Split on the export keyword rather than matching to a closing brace:
     * both signatures take an inline object type, so their `}): Promise<void>`
     * line starts with a brace in column zero and a lazy `\n}` match stops
     * before the body it was meant to read.
     */
    const bodies = notify
      .split("export async function ")
      .filter((part) => part.startsWith("notifySeller"));
    expect(bodies).toHaveLength(2);

    for (const fn of bodies) {
      expect(fn).toContain("try {");
      expect(fn).toContain("} catch (error) {");
      expect(fn).toContain("console.error");
    }
  });

  it("reports a manual payment after the reference is recorded", () => {
    // The write is what the buyer is waiting on; the email is not.
    const write = reference.indexOf("await db\n      .update(orders)");
    const send = reference.indexOf("notifySellerOfPaymentReport(");
    expect(write).toBeLessThan(send);
    expect(reference).toContain("after(async () => {");
  });
});

describe("the switches and the ceiling", () => {
  it("checks the shop's preference before every send", () => {
    expect(notify).toContain("wantsNotification(");
    // Booking requests and orders are different switches, chosen by the row.
    expect(notify).toContain('booking ? "bookingRequested" : "orderPlaced"');
    expect(notify).toContain('wantsNotification(shop.notificationPrefs, "orderNeedsAction")');
  });

  it("sends one mail per order, not two, when a booking is on it", () => {
    /*
     * A booked order is still an order, so the naive version sends both. The
     * seller's next move on a booking is accept-or-decline rather than fulfil,
     * so the booking mail replaces the order mail instead of joining it.
     */
    expect(notify).toContain("const booking = Boolean(order.scheduledFor);");
    expect(notify).toContain("? await sendSellerBookingRequested(");
    expect(notify).toContain(": await sendSellerOrderPlaced(");
  });

  it("caps a shop's daily volume so a bug cannot burn the quota", () => {
    expect(notify).toContain("const DAILY_CEILING = 500;");
    expect(notify).toContain("rateLimit(`seller-mail:${shopId}`, DAILY_CEILING, 86_400)");
  });

  it("logs the ceiling once rather than once per suppressed mail", () => {
    // A log line per suppressed send is how the one line that matters gets
    // lost in the five hundred that follow it.
    expect(notify).toContain("if (!verdict.allowed && !ceilingLogged.has(shopId))");
  });
});
