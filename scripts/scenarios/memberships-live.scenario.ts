import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { assertLocalDatabase } from "./local-only";
import { getDb } from "@/db";
import {
  clients,
  orders,
  paymentMethods,
  products,
  shops,
  subscriptions,
  user,
  type Product,
  type Shop,
} from "@/db/schema";
import { createSubscriptionSession, membershipPrice } from "@/lib/connect";
import { periodEndOf, subscriptionIdOf } from "@/lib/stripe-webhooks/memberships";
import { handleConnectEvent } from "@/lib/stripe-webhooks";
import { membershipAccess } from "@/lib/memberships";
import { platformFeePercent } from "@/lib/plans";

/**
 * Memberships against real Stripe.
 *
 * `memberships.scenario.ts` constructs every event by hand. That proves the
 * handlers make the right decisions and proves nothing whatsoever about
 * whether Stripe still *produces* those shapes — and this feature reads two
 * fields that have already moved once:
 *
 *   - `current_period_end` is on the subscription **item**, not the
 *     subscription (removed from the parent in `2025-03-31.basil`);
 *   - an invoice names its subscription through **`parent.subscription_details`**,
 *     not `invoice.subscription`.
 *
 * Both fail silently if Stripe moves them again. A member with no period end
 * is either locked out immediately or never; an invoice with no subscription
 * is a renewal that quietly writes no order. Nothing offline can catch that.
 *
 * So this calls the application's own modules — `membershipPrice`,
 * `createSubscriptionSession`, `periodEndOf`, `subscriptionIdOf`,
 * `handleConnectEvent` — against a real connected account. What is under test
 * is the integration, not a restatement of it.
 *
 * Needs `STRIPE_CONNECT_ACCOUNT`: a test connected account with
 * `charges_enabled`. Skipped entirely without one, so the ordinary scenario
 * suite stays offline. See `memberships-e2e.md`.
 *
 *   STRIPE_CONNECT_ACCOUNT=acct_… npx dotenv -e .env.local -- \
 *     npx vitest run --config vitest.scenarios.mts \
 *     scripts/scenarios/memberships-live.scenario.ts
 */

const ACCOUNT = process.env.STRIPE_CONNECT_ACCOUNT;
const db = getDb();
const uid = () => crypto.randomUUID();

describe.skipIf(!ACCOUNT)("memberships against real Stripe", () => {
  const acting = { stripeAccount: ACCOUNT as string };
  let stripe: Stripe;

  let shop: Shop;
  let product: Product;
  let clientId: string;
  let orderId: string;

  /** Carried between the phases below, which run in order and build on each other. */
  let priceId = "";
  let liveSub: Stripe.Subscription;
  let liveInvoice: Stripe.Invoice | undefined;
  let subscriptionRowId = "";

  beforeAll(async () => {
    assertLocalDatabase();

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key?.startsWith("sk_test")) {
      throw new Error("refusing to run without a test-mode secret key");
    }
    stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

    const userId = uid();
    await db.insert(user).values({
      id: userId,
      name: "Seller",
      email: `live-${userId.slice(0, 8)}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const [madeShop] = await db
      .insert(shops)
      .values({
        userId,
        handle: `live-${userId.slice(0, 8)}`,
        name: "Iron & Oak",
        currency: "USD",
        isPublished: true,
        plan: "business",
        subscriptionStatus: "active",
        stripeAccountId: ACCOUNT,
        stripeChargesEnabled: true,
        stripeDetailsSubmitted: true,
      })
      .returning();
    if (!madeShop) throw new Error("fixture: shop");
    shop = madeShop;

    await db.insert(paymentMethods).values({
      shopId: shop.id,
      type: "card",
      label: "card",
      config: {} as never,
      isEnabled: true,
      position: 0,
    });

    const [madeProduct] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Monthly membership",
        slug: `m-${uid().slice(0, 8)}`,
        kind: "membership",
        priceCents: 3_000,
        billingInterval: "month",
        isPublished: true,
        inStock: true,
      })
      .returning();
    if (!madeProduct) throw new Error("fixture: product");
    product = madeProduct;

    const [madeClient] = await db
      .insert(clients)
      .values({ shopId: shop.id, name: "Ada Member", email: "member-live@example.com" })
      .returning();
    if (!madeClient) throw new Error("fixture: client");
    clientId = madeClient.id;

    const [madeOrder] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        productId: product.id,
        clientId,
        productTitle: product.title,
        productKind: "membership",
        unitPriceCents: 3_000,
        subtotalCents: 3_000,
        totalCents: 3_000,
        currency: "USD",
        customerName: "Ada Member",
        customerEmail: "member-live@example.com",
        paymentMethod: "card",
        paymentStatus: "unpaid",
        status: "new",
        stripeAccountId: ACCOUNT,
        downloadToken: uid().replace(/-/g, ""),
      })
      .returning();
    if (!madeOrder) throw new Error("fixture: order");
    orderId = madeOrder.id;
  });

  const asEvent = (type: string, object: unknown) =>
    ({ id: `evt_live_${uid()}`, type, data: { object } }) as unknown as Stripe.Event;

  /* ---------------------------------------------------------------------- */

  it("mints a recurring Price Stripe accepts", async () => {
    priceId = await membershipPrice(shop, product);
    const price = await stripe.prices.retrieve(priceId, {}, acting);

    expect(price.recurring?.interval).toBe("month");
    expect(price.unit_amount).toBe(3_000);

    const cached = await db.query.products.findFirst({
      where: eq(products.id, product.id),
    });
    expect(cached?.stripePriceId).toBe(priceId);
    expect(cached?.stripePriceCents).toBe(3_000);
    expect(cached?.stripePriceInterval).toBe("month");
  });

  it("mints a new Price when the seller re-prices, rather than editing one", async () => {
    /*
     * A Stripe Price is immutable, and this is the assertion that proves our
     * staleness check does the right thing against the real API rather than
     * against our own idea of it.
     */
    await db
      .update(products)
      .set({ priceCents: 4_500 })
      .where(eq(products.id, product.id));
    const repriced = await db.query.products.findFirst({
      where: eq(products.id, product.id),
    });
    if (!repriced) throw new Error("product vanished");

    const second = await membershipPrice(shop, repriced);
    expect(second).not.toBe(priceId);
    expect((await stripe.prices.retrieve(second, {}, acting)).unit_amount).toBe(4_500);

    // Back to where the rest of the run expects it.
    await db
      .update(products)
      .set({ priceCents: 3_000, stripePriceId: priceId, stripePriceCents: 3_000 })
      .where(eq(products.id, product.id));
  });

  it("builds a subscription Checkout Session Stripe accepts whole", async () => {
    /*
     * The single most valuable assertion here: every parameter our code sends
     * — `application_fee_percent`, `adaptive_pricing`, `subscription_data`
     * metadata, the trial — is either accepted or this throws. Offline tests
     * cannot tell the difference between a correct parameter and an invented
     * one.
     */
    const fresh = await db.query.products.findFirst({
      where: eq(products.id, product.id),
    });
    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!fresh || !order) throw new Error("fixtures vanished");

    const session = await createSubscriptionSession({
      shop,
      order,
      product: fresh,
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/no",
    });

    expect(session.mode).toBe("subscription");
    expect(session.url).toBeTruthy();
    expect(session.metadata?.shopId).toBe(shop.id);
    expect(session.metadata?.orderId).toBe(orderId);
  });

  it("reads current_period_end off a real subscription", async () => {
    /*
     * Created through the API rather than by driving the hosted page: it is
     * the identical Subscription object, which is what the field reading is
     * under test against, and it needs no browser.
     */
    const customer = await stripe.customers.create(
      { email: "member-live@example.com", name: "Ada Member" },
      acting,
    );
    const pm = await stripe.paymentMethods.create(
      { type: "card", card: { token: "tok_visa" } },
      acting,
    );
    await stripe.paymentMethods.attach(pm.id, { customer: customer.id }, acting);

    liveSub = await stripe.subscriptions.create(
      {
        customer: customer.id,
        items: [{ price: priceId }],
        default_payment_method: pm.id,
        application_fee_percent: 0.5,
        metadata: {
          shopId: shop.id,
          productId: product.id,
          clientId,
          orderId,
        },
      },
      acting,
    );

    expect(liveSub.status).toBe("active");

    const end = periodEndOf(liveSub);
    expect(end).toBeInstanceOf(Date);
    expect(end?.getTime()).toBeGreaterThan(Date.now());
  });

  it("finds an invoice's subscription through parent.subscription_details", async () => {
    const list = await stripe.invoices.list(
      { subscription: liveSub.id, limit: 1 },
      acting,
    );
    liveInvoice = list.data[0];
    expect(liveInvoice).toBeTruthy();
    if (!liveInvoice) return;

    expect(subscriptionIdOf(liveInvoice)).toBe(liveSub.id);
  });

  it("actually pays Sailo its cut", async () => {
    /*
     * Asserted against the *platform's* application fee record, not against
     * `invoice.application_fee_amount` — which is null on a paid invoice in
     * this API version even when the fee has certainly been taken. Measured:
     * a $30.00 membership with `application_fee_percent: 0.5` produced a
     * `fee_…` of 15 cents on the platform while the invoice reported nothing.
     *
     * The fee is the one parameter whose absence costs money in complete
     * silence — every other symptom of getting it wrong is visible, and this
     * one is a payout that is quietly larger than it should be. So the test
     * looks where the money is.
     */
    const fees = await stripe.applicationFees.list({ limit: 20 });
    const ours = fees.data.filter((fee) => fee.account === ACCOUNT);

    expect(ours.length, "no application fee was taken on the connected account")
      .toBeGreaterThan(0);

    /*
     * Asserted as a *rate*, not as a number of cents.
     *
     * The connected account accumulates fees across runs at whatever price
     * the fixture happened to use, so a hardcoded amount is a test that
     * passes once. What has to hold every time is that what Stripe took
     * equals what our own code intends to take — so the expectation is
     * computed from `platformFeePercent` and the charge the fee sat on.
     */
    const rate = platformFeePercent(shop);
    for (const fee of ours) {
      const chargeId = typeof fee.charge === "string" ? fee.charge : fee.charge?.id;
      if (!chargeId) continue;
      const charge = await stripe.charges.retrieve(chargeId, {}, acting);
      expect(fee.amount, `fee on charge ${chargeId}`).toBe(
        Math.round((charge.amount * rate) / 100),
      );
      expect(fee.currency).toBe("usd");
    }
  });

  it("records the membership from the real event", async () => {
    const said = await handleConnectEvent(
      asEvent("customer.subscription.created", liveSub),
      ACCOUNT ?? null,
    );
    expect(said).toContain("membership");

    const row = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, liveSub.id),
    });
    if (!row) throw new Error("membership was not recorded");
    subscriptionRowId = row.id;

    expect(row.shopId).toBe(shop.id);
    expect(row.priceCents).toBe(3_000);
    expect(row.currentPeriodEnd?.getTime()).toBe(periodEndOf(liveSub)?.getTime());
    expect(membershipAccess(row).open).toBe(true);
  });

  it("settles the signup order from the real invoice, once", async () => {
    if (!liveInvoice) throw new Error("no invoice");

    await handleConnectEvent(asEvent("invoice.paid", liveInvoice), ACCOUNT ?? null);

    const settled = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(settled?.paymentStatus).toBe("paid");
    expect(settled?.stripeInvoiceId).toBe(liveInvoice.id);

    // The replay Stripe will eventually send.
    await handleConnectEvent(asEvent("invoice.paid", liveInvoice), ACCOUNT ?? null);

    const all = await db.query.orders.findMany({
      where: and(
        eq(orders.shopId, shop.id),
        eq(orders.subscriptionId, subscriptionRowId),
      ),
    });
    expect(all).toHaveLength(1);
  });

  it("keeps a cancelling member in until the period they paid for ends", async () => {
    const cancelled = await stripe.subscriptions.update(
      liveSub.id,
      { cancel_at_period_end: true },
      acting,
    );
    expect(cancelled.cancel_at_period_end).toBe(true);

    await handleConnectEvent(
      asEvent("customer.subscription.updated", cancelled),
      ACCOUNT ?? null,
    );

    const row = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionRowId),
    });
    if (!row) throw new Error("membership vanished");

    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(membershipAccess(row).open).toBe(true);
    expect(membershipAccess(row).endingSoon).toBe(true);
  });

  it("writes one order per real renewal, and no more", async () => {
    /*
     * The assertion nothing offline can make.
     *
     * A renewal is the whole point of a subscription and it happens a month
     * after anybody is watching, so this uses a Stripe **test clock** to make
     * one happen now: a subscription is created on a frozen clock, the clock
     * is advanced past the period end, and Stripe raises and pays a second
     * invoice for real.
     *
     * Both invoices then go through our own handler. What is being proved is
     * that the first settles the signup order and the second writes a *new*
     * one — the distinction the whole `stripe_invoice_id` unique index exists
     * to enforce, tested here against payloads Stripe actually produced
     * rather than ones we imagined.
     */
    const clock = await stripe.testHelpers.testClocks.create(
      { frozen_time: Math.floor(Date.now() / 1000) },
      acting,
    );
    const customer = await stripe.customers.create(
      { email: "clock-member@example.com", test_clock: clock.id },
      acting,
    );
    const pm = await stripe.paymentMethods.create(
      { type: "card", card: { token: "tok_visa" } },
      acting,
    );
    await stripe.paymentMethods.attach(pm.id, { customer: customer.id }, acting);

    // Its own order and its own subscription row, so the counts below are
    // unambiguous.
    const [clockOrder] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        productId: product.id,
        clientId,
        productTitle: product.title,
        productKind: "membership",
        unitPriceCents: 3_000,
        subtotalCents: 3_000,
        totalCents: 3_000,
        currency: "USD",
        customerName: "Ada Member",
        customerEmail: "clock-member@example.com",
        paymentMethod: "card",
        paymentStatus: "unpaid",
        status: "new",
        stripeAccountId: ACCOUNT,
        downloadToken: uid().replace(/-/g, ""),
      })
      .returning();
    if (!clockOrder) throw new Error("fixture: clock order");

    const clockSub = await stripe.subscriptions.create(
      {
        customer: customer.id,
        items: [{ price: priceId }],
        default_payment_method: pm.id,
        application_fee_percent: 0.5,
        metadata: {
          shopId: shop.id,
          productId: product.id,
          clientId,
          orderId: clockOrder.id,
        },
      },
      acting,
    );
    await handleConnectEvent(
      asEvent("customer.subscription.created", clockSub),
      ACCOUNT ?? null,
    );

    // Forward, past the end of the period Stripe just billed for.
    const periodEnd = periodEndOf(clockSub);
    if (!periodEnd) throw new Error("subscription has no period end");
    await stripe.testHelpers.testClocks.advance(
      clock.id,
      { frozen_time: Math.floor(periodEnd.getTime() / 1000) + 86_400 },
      acting,
    );

    // Advancing is asynchronous; Stripe raises the renewal while it settles.
    for (let i = 0; i < 40; i += 1) {
      const state = await stripe.testHelpers.testClocks.retrieve(clock.id, {}, acting);
      if (state.status === "ready") break;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }

    const invoices = await stripe.invoices.list(
      { subscription: clockSub.id, limit: 10 },
      acting,
    );
    expect(
      invoices.data.length,
      "the test clock did not produce a renewal invoice",
    ).toBeGreaterThanOrEqual(2);

    // Oldest first, so the signup is handled before the renewal.
    const ordered = [...invoices.data].sort((a, b) => a.created - b.created);
    for (const invoice of ordered) {
      expect(subscriptionIdOf(invoice)).toBe(clockSub.id);
      await handleConnectEvent(asEvent("invoice.paid", invoice), ACCOUNT ?? null);
    }

    const row = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, clockSub.id),
    });
    if (!row) throw new Error("membership was not recorded");

    const written = await db.query.orders.findMany({
      where: and(eq(orders.shopId, shop.id), eq(orders.subscriptionId, row.id)),
    });
    // One for the signup, one for the renewal.
    expect(written).toHaveLength(ordered.length);

    const signup = written.find((o) => o.id === clockOrder.id);
    expect(signup?.paymentStatus).toBe("paid");
    // Every order carries the invoice that paid for it, and no two share one.
    const invoiceIds = written.map((o) => o.stripeInvoiceId);
    expect(new Set(invoiceIds).size).toBe(written.length);

    // And the replays Stripe will send write nothing further.
    for (const invoice of ordered) {
      await handleConnectEvent(asEvent("invoice.paid", invoice), ACCOUNT ?? null);
    }
    const afterReplay = await db.query.orders.findMany({
      where: and(eq(orders.shopId, shop.id), eq(orders.subscriptionId, row.id)),
    });
    expect(afterReplay).toHaveLength(written.length);
  }, 180_000);

  it("refuses an event from an account that does not own the shop", async () => {
    // The security seam, against a real payload rather than a hand-built one.
    const said = await handleConnectEvent(
      asEvent("customer.subscription.created", liveSub),
      "acct_someone_else",
    );
    expect(said).toContain("not this account's shop");
  });
});
