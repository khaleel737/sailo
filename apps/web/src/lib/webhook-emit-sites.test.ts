import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { WEBHOOK_EVENTS } from "@sailo/webhooks/events";

/**
 * Where events are emitted from, asserted against the source.
 *
 * The two properties this file protects cannot be reached by calling anything:
 * they are facts about *where* a call sits, and both are silent when broken.
 *
 * **Every emit is inside `after()`.** Awaited on the request path instead, a
 * webhook puts an HTTP call to a stranger's server between a buyer pressing
 * Pay and their confirmation page — and, worse, an emit that runs before the
 * business write commits sends a lie that cannot be recalled, because the Zap
 * has already run.
 *
 * **Every event in the catalogue has an emit site.** A name listed with
 * nothing behind it is a checkbox a seller ticks, waits on, and concludes the
 * feature is broken.
 *
 * `notify-seller.test.ts` established this pattern in this codebase for
 * exactly the same reason.
 *
 * **Two of the sites are no longer in this app**, and following them across
 * the boundary is the point rather than an inconvenience. `order.cancelled` and
 * `booking.confirmed` hang off a status change, and a status change is made
 * from a phone as well as from this admin — so they moved into
 * `@sailo/commerce`, which both surfaces call. They were written here, where
 * `after()` was to hand, and the consequence was that the surface without
 * `after()` emitted nothing at all. The rules are unchanged and are asserted
 * below at their new address; what replaced `after()` there is the `defer` hook,
 * which this app passes and a phone does not.
 */


const read = (path: string) => readFileSync(path, "utf8");

/**
 * A file inside a workspace package, found through the package rather than by
 * a relative path.
 *
 * `../../packages/...` worked while every subject was one directory away and
 * broke the moment `broadcasts` became `@sailo/marketing`. Resolving the entry
 * point and swapping the filename survives the next move too, and fails loudly
 * if the package stops exporting that entry at all.
 */
const pkg = (spec: string, file: string) =>
  read(createRequire(import.meta.url).resolve(spec).replace(/[^/]+$/, file));

const ORDERS = read("src/lib/actions/orders.ts");
const ORDER_ADMIN = read("src/lib/actions/order-admin.ts");
const CONNECT = read("src/lib/stripe-webhooks/connect.ts");
const CLIENTS = read("src/lib/actions/clients.ts");
const SUBSCRIBE = pkg("@sailo/marketing/broadcasts", "subscribe.ts");
const PAY_ORDER = pkg("@sailo/commerce/orders", "pay-order.ts");
const COMMERCE_ORDERS = pkg("@sailo/commerce/orders", "orders.ts");
const MEMBERSHIP_LIFECYCLE = read("src/lib/stripe-webhooks/memberships/lifecycle.ts");
const MEMBERSHIP_INVOICES = read("src/lib/stripe-webhooks/memberships/invoices.ts");
const DISPUTES = read("src/lib/stripe-webhooks/disputes.ts");
/*
 * The three events nothing *names* at a call site.
 *
 * `plan_changed`, `cancelled` and `resumed` all arrive from Stripe as one
 * indistinguishable `customer.subscription.updated`, so the handler emits
 * whatever `subscriptionTransitions` returns rather than a literal it chose.
 * That makes this file their emit site as far as the catalogue check below is
 * concerned — and it is the honest answer, because it is the only place that
 * decides they happened.
 */
const TRANSITIONS = pkg("@sailo/webhooks/events", "transitions.ts");

const ALL_SOURCES = [
  ORDERS,
  ORDER_ADMIN,
  CONNECT,
  CLIENTS,
  SUBSCRIBE,
  COMMERCE_ORDERS,
  MEMBERSHIP_LIFECYCLE,
  MEMBERSHIP_INVOICES,
  DISPUTES,
  TRANSITIONS,
].join("\n");

describe("emit sites", () => {
  it("wraps every emit on a request path in after()", () => {
    /*
     * `connect.ts` is the deliberate exception and is checked separately
     * below: it is a Stripe webhook handler, not a request somebody is
     * waiting on, and `after()` there would race the function shutting down.
     */
    for (const [name, source] of [
      ["orders.ts", ORDERS],
      ["order-admin.ts", ORDER_ADMIN],
      ["clients.ts", CLIENTS],
    ] as const) {
      const sites = [...source.matchAll(/emit(?:Order|Contact)Webhook\(/g)]
        // The `import { … } from` line names them too and is not a call.
        .filter((match) => !source.slice(0, match.index).endsWith("import { "));

      expect(sites.length, `${name} emits nothing`).toBeGreaterThan(0);

      for (const site of sites) {
        // `after(() =>` may sit on the same line or the one above it, so the
        // window is the preceding stretch rather than the preceding token.
        const before = source.slice(Math.max(0, site.index - 40), site.index);
        expect(before, `${name} emits outside after() at ${site.index}`).toContain(
          "after(() =>",
        );
      }
    }
  });

  it("emits order.created on the rails that settle at checkout", () => {
    expect(ORDERS).toContain('event: "order.created"');
    // Guarded by the same discriminator the buyer's and seller's mail use, so
    // exactly one of the two sites fires per order.
    expect(ORDERS).toContain("if (settlesAtCheckout)");
  });

  it("emits order.created and order.paid together when a card settles", () => {
    expect(CONNECT).toContain('event: "order.created"');
    expect(CONNECT).toContain('event: "order.paid"');
    /*
     * Behind the pre-update status read, so a redelivered settling event for
     * an order already marked paid adds nothing.
     */
    expect(CONNECT).toContain('if (order.paymentStatus !== "paid")');
  });

  it("emits the three events this app still owns", () => {
    for (const event of ["order.paid", "order.shipped", "order.refunded"]) {
      expect(ORDER_ADMIN, event).toContain(`event: "${event}"`);
    }
  });

  it("emits the two that hang off a status change, where both surfaces call", () => {
    // In @sailo/commerce, so a seller cancelling from a phone fires the same
    // Zap as one cancelling from this dropdown. That is the whole reason they
    // are not in the file above.
    for (const event of ["order.cancelled", "booking.confirmed"]) {
      expect(COMMERCE_ORDERS, event).toContain(`event: "${event}"`);
    }
    expect(ORDER_ADMIN).not.toContain('event: "order.cancelled"');
    expect(ORDER_ADMIN).not.toContain('event: "booking.confirmed"');
  });

  it("guards order.paid on a transition rather than a save", () => {
    /*
     * Re-saving a dropdown that already said paid is not a payment, and a Zap
     * that raises an invoice would raise a second one.
     *
     * The guard used to be spelled here as `before?.paymentStatus !== "paid"`,
     * read off a row this file fetched for itself. It moved with the rest of
     * what confirming a payment does — the phone sets a payment status now, and
     * a surface that only flipped the column would leave a buyer who had paid
     * unable to download what they bought. `becamePaid` is the same question,
     * answered by the function that did the write, which is the only place that
     * can answer it without a second read racing the first.
     */
    expect(ORDER_ADMIN).toContain("result.becamePaid");
    expect(PAY_ORDER).toContain('before.paymentStatus !== "paid"');
  });

  it("guards order.cancelled and booking.confirmed on the previous status", () => {
    /*
     * `previous`, because `applyOrderStatus` hands back the row as it read
     * *before* the write. The rule is unchanged by the move and the assertions
     * are the same two strings they always were, now read at the address that
     * holds them: a seller re-saving an order that was already cancelled has
     * changed nothing, and firing a Zap for it is how a customer receives the
     * same "your order was cancelled" message four times.
     *
     * Both live in `orderTransition`, which is a plain function over the
     * previous row and the new status — so unlike every other assertion in this
     * file the rule can also be *called*, and `@sailo/commerce` does call it.
     */
    expect(COMMERCE_ORDERS).toContain('previous.status !== "cancelled"');
    expect(COMMERCE_ORDERS).toContain('previous.status === "new"');
  });

  it("keeps the moved emits off the caller's critical path too", () => {
    /*
     * The replacement for `after()` on the other side of the boundary.
     *
     * `@sailo/commerce` cannot import `after` — there is no Next request scope
     * in apps/api — so it takes a `defer` hook and awaits when given none. Both
     * halves are asserted: that the package routes its emits through the seam
     * rather than calling them inline, and that this app, which does have
     * `after`, hands it over. A web action that stopped passing it would put a
     * webhook queue insert back in front of the seller's click.
     */
    const emits = [...COMMERCE_ORDERS.matchAll(/emitOrderWebhook\(/g)].filter(
      (match) => !COMMERCE_ORDERS.slice(0, match.index).endsWith("import { "),
    );
    expect(emits.length, "@sailo/commerce emits nothing").toBeGreaterThan(0);
    for (const emit of emits) {
      const before = COMMERCE_ORDERS.slice(Math.max(0, emit.index - 40), emit.index);
      expect(before, `emit outside the defer seam at ${emit.index}`).toContain(
        "settle(",
      );
    }
    expect(ORDER_ADMIN).toContain("defer: after");
  });

  it("emits contact.created only where a contact is genuinely new", () => {
    // Both sites sit behind an insert that returned a row — an
    // `onConflictDoNothing` that returned nothing is somebody the shop already
    // had, and welcoming them again is how a list gets re-sequenced.
    expect(CLIENTS).toContain("emitContactWebhook");
    expect(CLIENTS).toContain("if (created)");
    expect(SUBSCRIBE).toContain("emitNewContact");
    expect(SUBSCRIBE).toContain("if (created)");
  });

  it("emits the membership events from the handlers that own them", () => {
    expect(MEMBERSHIP_LIFECYCLE).toContain('event: "subscription.created"');
    expect(MEMBERSHIP_LIFECYCLE).toContain('event: "subscription.ended"');
    expect(MEMBERSHIP_INVOICES).toContain('event: "subscription.renewed"');
    expect(MEMBERSHIP_INVOICES).toContain('event: "subscription.payment_failed"');
  });

  it("emits subscription.renewed only for a renewal, never for the signup", () => {
    /*
     * The signup's first invoice settling is not a renewal — a consumer told
     * one had happened would record a completed billing cycle for a member who
     * joined this morning. `firstPayment` is the row the signup order's
     * conditional update returned, so its absence is precisely "this money was
     * not the first".
     */
    expect(MEMBERSHIP_INVOICES).toContain("if (!firstPayment)");
  });

  it("emits subscription.payment_failed only when the status actually moved", () => {
    // Below the compare-and-set guard, so a redelivered or late failure that
    // changed nothing does not tell an integration a payment just failed.
    expect(MEMBERSHIP_INVOICES).toContain("if (!advanced)");
  });

  it("derives the three ambiguous membership events rather than guessing", () => {
    /*
     * Stripe names a plan swap, a cancellation and a resumption identically, so
     * the handler must compare the row it held against the row it wrote. The
     * pre-update row is `known.row` — read for the comparison and not only for
     * the shop, which is the detail an innocent-looking refactor removes.
     */
    expect(MEMBERSHIP_LIFECYCLE).toContain("subscriptionTransitions(known?.row ?? null, row)");
    for (const event of [
      "subscription.plan_changed",
      "subscription.cancelled",
      "subscription.resumed",
    ]) {
      expect(TRANSITIONS, event).toContain(event);
    }
  });

  it("emits disputes for a buyer's chargeback and never for the platform's", () => {
    /*
     * A seller charging back their own Sailo subscription is Sailo's money. The
     * platform branch returns before the emit, so it can never arrive in that
     * seller's Zapier account dressed as a customer chargeback.
     */
    expect(DISPUTES).toContain("emitDisputeWebhook");
    expect(DISPUTES).toContain('return handlePlatformDispute(');
    const emitAt = DISPUTES.indexOf("emitDisputeWebhook({");
    const platformReturn = DISPUTES.indexOf("return handlePlatformDispute(");
    expect(platformReturn, "platform disputes must return before the emit").toBeLessThan(
      emitAt,
    );
  });

  it("has an emit site for every event in the catalogue", () => {
    for (const event of WEBHOOK_EVENTS) {
      expect(ALL_SOURCES, `${event} is listed but never emitted`).toContain(event);
    }
  });
});

