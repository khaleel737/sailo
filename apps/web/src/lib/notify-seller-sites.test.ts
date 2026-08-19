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
 * `notifySellerOfOrder` is `@sailo/workflows/orders` now.
 *
 * It started in this app, moved to `@sailo/commerce` so the phone could settle an
 * order and still tell the seller, and then moved again — because its whole body
 * is "read an order, check a preference, send an email, send a push", which makes
 * it about none of commerce, email or notifications. Holding it inside commerce
 * was what made commerce depend on the other two.
 *
 * This test stayed here through both moves, because the two *send sites* it pins
 * are both this app's and what it guards is which branch each one sits in.
 */
const notify = readFileSync(
  createRequire(import.meta.url)
    .resolve("@sailo/workflows/orders")
    .replace(/index\.ts$/, "notify-seller.ts"),
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
     * reaches here twice.
     *
     * This assertion used to name the pre-update status read,
     * `if (order.paymentStatus !== "paid")`, and say that it was what stopped
     * the resend. It was not: both deliveries read the row before either wrote
     * to it, so both passed. The guard is the settlement claim — the status is
     * in the UPDATE's own WHERE and `returning` says who won it — and it is the
     * shape, not the placement, that makes this once-only.
     */
    expect(connect).toContain(
      '.where(and(eq(orders.id, order.id), ne(orders.paymentStatus, "paid")))',
    );
    expect(connect).toContain("const settledHere = settleClaim.length > 0;");
    expect(connect).toContain("if (settledHere) {");
    // And the read it replaced is gone, rather than left beside it.
    expect(connect).not.toContain('if (order.paymentStatus !== "paid") {');
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
    /*
     * The count is a tripwire, not a fact worth pinning for its own sake: a new
     * entry point that forgets its `try` is exactly the failure this test
     * exists to catch, and a hard number is what makes somebody read the loop
     * below when they add one. Three since spec 51 added `notifySellerOfLowStock`.
     */
    const bodies = notify
      .split("export async function ")
      .filter((part) => part.startsWith("notifySeller"));
    expect(bodies).toHaveLength(3);

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
