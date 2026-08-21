import type Stripe from "stripe";
import { assertLocalDatabase } from "./local-only";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  invoices,
  orders,
  paymentMethods,
  productFiles,
  products,
  shops,
  subscriptions,
  user,
} from "@sailo/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { handleConnectEvent } from "@/lib/stripe-webhooks";
import { accessForOrder, membershipOpenForOrder } from "@/lib/membership-access";
import { createManualSubscription, extendForPaidOrder } from "@sailo/commerce/memberships/server";
import { runManualRenewals } from "@sailo/workflows/memberships";
import { RENEWAL_LEAD_DAYS } from "@sailo/commerce/memberships";

/**
 * Recurring memberships, against a real database.
 *
 * This is money that arrives again next month without anybody pressing
 * anything, which makes it the one feature where a bug does not announce
 * itself: a renewal recorded twice is a month of revenue that is simply wrong,
 * a member let in after cancelling is a month given away, and neither shows up
 * anywhere until somebody reconciles a payout by hand.
 *
 * So every assertion here is a claim about what happens when Stripe behaves
 * the way Stripe actually behaves: delivering the same event twice, delivering
 * events out of order, and delivering them from an account that may not be the
 * one that owns the row being named.
 *
 * No Stripe API call and no connected account — the events are constructed and
 * handed to the same `handleConnectEvent` the route calls.
 *
 * Two things that leaves uncovered, stated rather than implied. Stripe
 * actually producing these shapes is one: for that, `stripe listen` against a
 * test-mode account is still the only proof, and `card-e2e.md` is the
 * precedent for running it. The other is `checkout.session.completed` in
 * subscription mode, whose handler retrieves the subscription from Stripe —
 * a network call this suite will not make. Every row it would write is
 * written by `customer.subscription.created` as well, which is exercised
 * below, and the ordering guarantees are the same either way.
 */

const db = getDb();
const uid = () => crypto.randomUUID();
const ACCOUNT = "acct_membership_seller";
const OTHER_ACCOUNT = "acct_somebody_else";

beforeAll(() => {
  assertLocalDatabase();
});

async function makeShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `member-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  /*
   * One live holder per connected account — the uniqueness 0064 gives
   * production holds in scenarios too. Earlier tests' fixture shops release
   * the account the way a real reconnect would.
   */
  const claimedAccount =
    (over as { stripeAccountId?: string | null }).stripeAccountId ?? ACCOUNT;
  if (claimedAccount) {
    await db
      .update(shops)
      .set({ stripeAccountId: null })
      .where(eq(shops.stripeAccountId, claimedAccount));
  }
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `gym-${userId.slice(0, 8)}`,
      name: "Iron & Oak",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: true,
      stripeDetailsSubmitted: true,
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "card",
    label: "card",
    config: {} as never,
    isEnabled: true,
    position: 0,
  });
  return shop;
}

async function makeMembership(
  shopId: string,
  over: Partial<typeof products.$inferInsert> = {},
) {
  const [row] = await db
    .insert(products)
    .values({
      shopId,
      title: "Monthly membership",
      slug: `m-${uid().slice(0, 8)}`,
      kind: "membership",
      priceCents: 3_000,
      billingInterval: "month",
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!row) throw new Error("fixture: membership was not inserted");
  return row;
}

async function makeClient(shopId: string, email = "member@example.com") {
  const [row] = await db
    .insert(clients)
    .values({ shopId, name: "Ada Member", email })
    .returning();
  if (!row) throw new Error("fixture: client was not inserted");
  return row;
}

/** The order the signup wrote, waiting for its first invoice. */
async function makeSignupOrder(opts: {
  shopId: string;
  productId: string;
  clientId: string;
  downloadToken?: string | null;
}) {
  const [row] = await db
    .insert(orders)
    .values({
      shopId: opts.shopId,
      productId: opts.productId,
      clientId: opts.clientId,
      productTitle: "Monthly membership",
      productKind: "membership",
      unitPriceCents: 3_000,
      subtotalCents: 3_000,
      totalCents: 3_000,
      quantity: 1,
      itemCount: 1,
      currency: "USD",
      customerName: "Ada Member",
      customerEmail: "member@example.com",
      paymentMethod: "card",
      paymentStatus: "unpaid",
      status: "new",
      stripeAccountId: ACCOUNT,
      downloadToken: opts.downloadToken ?? uid().replace(/-/g, ""),
    })
    .returning();
  if (!row) throw new Error("fixture: signup order was not inserted");
  return row;
}

/* --------------------------------------------------------------------------
   Stripe shapes

   Built by hand to the *current* API version, which is the point of building
   them at all: `current_period_end` lives on the item and an invoice names its
   subscription through `parent.subscription_details`. Reading either from
   where it used to be compiles and returns undefined forever.
-------------------------------------------------------------------------- */

function stripeSubscription(over: {
  id: string;
  status?: string;
  periodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  trialEnd?: Date | null;
  metadata?: Record<string, string>;
  unitAmount?: number;
  interval?: "month" | "year";
  customer?: string;
}): Stripe.Subscription {
  const end = over.periodEnd ?? new Date(Date.now() + 30 * 86_400_000);
  return {
    id: over.id,
    object: "subscription",
    status: over.status ?? "active",
    customer: over.customer ?? "cus_member_1",
    cancel_at_period_end: over.cancelAtPeriodEnd ?? false,
    canceled_at: over.canceledAt ? Math.floor(over.canceledAt.getTime() / 1000) : null,
    trial_end: over.trialEnd ? Math.floor(over.trialEnd.getTime() / 1000) : null,
    metadata: over.metadata ?? {},
    items: {
      object: "list",
      data: [
        {
          id: "si_1",
          object: "subscription_item",
          current_period_end: Math.floor(end.getTime() / 1000),
          price: {
            id: "price_1",
            object: "price",
            unit_amount: over.unitAmount ?? 3_000,
            currency: "usd",
            recurring: { interval: over.interval ?? "month" },
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

function stripeInvoice(over: {
  id: string;
  subscriptionId: string;
  amountPaid?: number;
  currency?: string;
  hostedUrl?: string | null;
  customerEmail?: string | null;
}): Stripe.Invoice {
  return {
    id: over.id,
    object: "invoice",
    amount_paid: over.amountPaid ?? 3_000,
    currency: over.currency ?? "usd",
    customer: "cus_member_1",
    customer_email: over.customerEmail ?? "member@example.com",
    hosted_invoice_url: over.hostedUrl ?? "https://invoice.stripe.com/i/test",
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: {
        subscription: over.subscriptionId,
        metadata: null,
      },
    },
  } as unknown as Stripe.Invoice;
}

const event = (type: string, object: unknown): Stripe.Event =>
  ({ id: `evt_${uid()}`, type, data: { object } }) as unknown as Stripe.Event;

/**
 * A fresh Stripe-shaped invoice id.
 *
 * Unique per run, because the unique index on `stripe_invoice_id` is global
 * and this database is not reset between runs — a literal like `in_month_1`
 * passes once and then fails for ever, which reads exactly like the bug the
 * index exists to catch.
 */
const invoiceId = (label: string) => `in_${label}_${uid().slice(0, 8)}`;

const subRow = (stripeId: string) =>
  db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeId),
  });

const ordersFor = (subscriptionRowId: string) =>
  db.query.orders.findMany({ where: eq(orders.subscriptionId, subscriptionRowId) });

/* -------------------------------------------------------------------------- */

describe("a member subscribing", () => {
  it("records the subscription and links the order that started it", async () => {
    const shop = await makeShop();
    const product = await makeMembership(shop.id);
    const client = await makeClient(shop.id);
    const order = await makeSignupOrder({
      shopId: shop.id,
      productId: product.id,
      clientId: client.id,
    });
    const stripeId = `sub_${uid().slice(0, 8)}`;

    /*
     * `customer.subscription.created` rather than the checkout session, so no
     * Stripe API call is needed: the session handler retrieves the
     * subscription, and this suite deliberately makes no network calls. The
     * ordering hazard that matters is covered on its own below.
     */
    await handleConnectEvent(
      event(
        "customer.subscription.created",
        stripeSubscription({
          id: stripeId,
          metadata: {
            shopId: shop.id,
            productId: product.id,
            clientId: client.id,
            orderId: order.id,
          },
        }),
      ),
      ACCOUNT,
    );

    const row = await subRow(stripeId);
    expect(row?.shopId).toBe(shop.id);
    expect(row?.productId).toBe(product.id);
    expect(row?.clientId).toBe(client.id);
    expect(row?.status).toBe("active");
    expect(row?.priceCents).toBe(3_000);
    expect(row?.interval).toBe("month");
    // Snapshotted from the account the event arrived on, not the shop row.
    expect(row?.stripeAccountId).toBe(ACCOUNT);
    // And the period end came off the *item*, which is where it now lives.
    expect(row?.currentPeriodEnd).not.toBeNull();
  });

  it("is idempotent — the same event twice is one member", async () => {
    const shop = await makeShop();
    const product = await makeMembership(shop.id);
    const stripeId = `sub_${uid().slice(0, 8)}`;
    const created = event(
      "customer.subscription.created",
      stripeSubscription({ id: stripeId, metadata: { shopId: shop.id, productId: product.id } }),
    );

    await handleConnectEvent(created, ACCOUNT);
    await handleConnectEvent(created, ACCOUNT);

    const rows = await db.query.subscriptions.findMany({
      where: eq(subscriptions.stripeSubscriptionId, stripeId),
    });
    expect(rows).toHaveLength(1);
  });

  it("refuses an event from an account that does not own the shop", async () => {
    /*
     * The security seam. Every seller controls their own Stripe account, so
     * metadata naming a shop is a claim by the sender — a rival could
     * otherwise write rows into this shop's members list from their own
     * account.
     */
    const shop = await makeShop();
    const product = await makeMembership(shop.id);
    const stripeId = `sub_${uid().slice(0, 8)}`;

    const result = await handleConnectEvent(
      event(
        "customer.subscription.created",
        stripeSubscription({
          id: stripeId,
          metadata: { shopId: shop.id, productId: product.id },
        }),
      ),
      OTHER_ACCOUNT,
    );

    expect(result).toContain("not this account's shop");
    expect(await subRow(stripeId)).toBeUndefined();
  });
});

describe("the money arriving", () => {
  async function subscribed() {
    const shop = await makeShop();
    const product = await makeMembership(shop.id);
    const client = await makeClient(shop.id);
    const order = await makeSignupOrder({
      shopId: shop.id,
      productId: product.id,
      clientId: client.id,
    });
    const stripeId = `sub_${uid().slice(0, 8)}`;
    await handleConnectEvent(
      event(
        "customer.subscription.created",
        stripeSubscription({
          id: stripeId,
          metadata: {
            shopId: shop.id,
            productId: product.id,
            clientId: client.id,
            orderId: order.id,
          },
        }),
      ),
      ACCOUNT,
    );
    const row = await subRow(stripeId);
    if (!row) throw new Error("fixture: subscription was not written");
    return { shop, product, client, order, stripeId, row };
  }

  it("settles the signup order rather than writing a second one", async () => {
    const { shop, order, stripeId, row } = await subscribed();

    await handleConnectEvent(
      event("invoice.paid", stripeInvoice({ id: invoiceId("signup"), subscriptionId: stripeId })),
      ACCOUNT,
    );

    const paid = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    expect(paid?.paymentStatus).toBe("paid");
    expect(paid?.status).toBe("confirmed");
    expect(paid?.stripeInvoiceId).not.toBeNull();

    // One order for the signup, not two.
    expect(await ordersFor(row.id)).toHaveLength(1);

    // And an invoice number, claimed once.
    const issued = await db.query.invoices.findMany({
      where: and(eq(invoices.shopId, shop.id), eq(invoices.orderId, order.id)),
    });
    expect(issued).toHaveLength(1);
  });

  it("writes one ordinary order per renewal", async () => {
    const { stripeId, row } = await subscribed();

    const first = invoiceId("month1");
    const second = invoiceId("month2");

    // Month one settles the signup order.
    await handleConnectEvent(
      event("invoice.paid", stripeInvoice({ id: first, subscriptionId: stripeId })),
      ACCOUNT,
    );
    // Month two is a renewal and gets its own.
    await handleConnectEvent(
      event("invoice.paid", stripeInvoice({ id: second, subscriptionId: stripeId })),
      ACCOUNT,
    );

    const all = await ordersFor(row.id);
    expect(all).toHaveLength(2);

    const renewal = all.find((o) => o.stripeInvoiceId === second);
    expect(renewal?.paymentStatus).toBe("paid");
    expect(renewal?.totalCents).toBe(3_000);
    expect(renewal?.productKind).toBe("membership");
    // A renewal ships nothing and books nothing.
    expect(renewal?.deliveryMethod).toBeNull();
    expect(renewal?.scheduledFor).toBeNull();
  });

  it("records one order when the same invoice arrives twice", async () => {
    /*
     * The expensive one. `stripe_events` de-duplicates whole events but not
     * the same invoice arriving under two different event ids — and a renewal
     * counted twice is a month of revenue that is simply wrong, with nothing
     * anywhere reporting it. The unique index is what refuses it.
     */
    const { stripeId, row } = await subscribed();
    // The signup's own invoice first, so the replay below is a renewal.
    await handleConnectEvent(
      event("invoice.paid", stripeInvoice({ id: invoiceId("signup"), subscriptionId: stripeId })),
      ACCOUNT,
    );

    const replayed = invoiceId("replay");
    const twice = stripeInvoice({ id: replayed, subscriptionId: stripeId });
    await handleConnectEvent(event("invoice.paid", twice), ACCOUNT);
    await handleConnectEvent(event("invoice.paid", twice), ACCOUNT);

    const renewals = (await ordersFor(row.id)).filter(
      (o) => o.stripeInvoiceId === replayed,
    );
    expect(renewals).toHaveLength(1);
  });

  it("ignores an invoice that paid nothing", async () => {
    // A trial's first invoice is zero. Writing an order for it would show a
    // sale that never happened.
    const { stripeId, row } = await subscribed();
    await handleConnectEvent(
      event(
        "invoice.paid",
        stripeInvoice({ id: invoiceId("zero"), subscriptionId: stripeId, amountPaid: 0 }),
      ),
      ACCOUNT,
    );

    /*
     * The signup order exists and is linked — that happened when the
     * subscription was created. What must not have happened is any of it being
     * marked paid, or a renewal written, for money that never arrived.
     */
    const all = await ordersFor(row.id);
    expect(all.filter((o) => o.paymentStatus === "paid")).toHaveLength(0);
    expect(all.filter((o) => o.stripeInvoiceId !== null)).toHaveLength(0);
  });

  it("ignores an invoice that is not for a subscription at all", async () => {
    const shop = await makeShop();
    expect(shop.id).toBeTruthy();
    const loose = {
      id: invoiceId("loose"),
      object: "invoice",
      amount_paid: 5_000,
      parent: null,
    } as unknown as Stripe.Invoice;

    const result = await handleConnectEvent(event("invoice.paid", loose), ACCOUNT);
    expect(result).toContain("not for a subscription");
  });
});

describe("a card that fails", () => {
  it("marks the member past due without taking their access away", async () => {
    /*
     * Stripe retries for days. Revoking here would lock somebody out over a
     * bank's fraud check while our own dunning email was still in flight —
     * and the period they already paid for is the boundary that actually
     * matters.
     */
    const shop = await makeShop();
    const product = await makeMembership(shop.id);
    const client = await makeClient(shop.id);
    const order = await makeSignupOrder({
      shopId: shop.id,
      productId: product.id,
      clientId: client.id,
    });
    const stripeId = `sub_${uid().slice(0, 8)}`;
    await handleConnectEvent(
      event(
        "customer.subscription.created",
        stripeSubscription({
          id: stripeId,
          metadata: {
            shopId: shop.id,
            productId: product.id,
            clientId: client.id,
            orderId: order.id,
          },
        }),
      ),
      ACCOUNT,
    );

    await handleConnectEvent(
      event(
        "invoice.payment_failed",
        stripeInvoice({ id: invoiceId("failed"), subscriptionId: stripeId }),
      ),
      ACCOUNT,
    );

    const row = await subRow(stripeId);
    expect(row?.status).toBe("past_due");

    const fresh = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    if (!fresh) throw new Error("order vanished");
    expect(await membershipOpenForOrder(fresh)).toBe(true);
  });
});

describe("stopping", () => {
  async function live() {
    const shop = await makeShop();
    const product = await makeMembership(shop.id);
    const client = await makeClient(shop.id);
    const order = await makeSignupOrder({
      shopId: shop.id,
      productId: product.id,
      clientId: client.id,
    });
    const stripeId = `sub_${uid().slice(0, 8)}`;
    const metadata = {
      shopId: shop.id,
      productId: product.id,
      clientId: client.id,
      orderId: order.id,
    };
    await handleConnectEvent(
      event("customer.subscription.created", stripeSubscription({ id: stripeId, metadata })),
      ACCOUNT,
    );
    return { shop, product, client, order, stripeId, metadata };
  }

  it("keeps access through a cancellation that takes effect at period end", async () => {
    const { order, stripeId, metadata } = await live();

    await handleConnectEvent(
      event(
        "customer.subscription.updated",
        stripeSubscription({ id: stripeId, cancelAtPeriodEnd: true, metadata }),
      ),
      ACCOUNT,
    );

    const row = await subRow(stripeId);
    expect(row?.cancelAtPeriodEnd).toBe(true);
    expect(row?.status).toBe("active");

    const fresh = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    if (!fresh) throw new Error("order vanished");
    const access = await accessForOrder(fresh);
    expect(access.access.open).toBe(true);
    expect(access.access.endingSoon).toBe(true);
  });

  it("closes the door once the paid period is behind them", async () => {
    const { order, stripeId, metadata } = await live();

    await handleConnectEvent(
      event(
        "customer.subscription.updated",
        stripeSubscription({
          id: stripeId,
          status: "canceled",
          periodEnd: new Date(Date.now() - 86_400_000),
          canceledAt: new Date(Date.now() - 2 * 86_400_000),
          metadata,
        }),
      ),
      ACCOUNT,
    );

    const fresh = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    if (!fresh) throw new Error("order vanished");
    expect(await membershipOpenForOrder(fresh)).toBe(false);
  });

  it("keeps the period end when Stripe deletes the subscription", async () => {
    // Clearing it would take back access somebody has already paid for.
    const { stripeId, metadata } = await live();
    const before = await subRow(stripeId);

    await handleConnectEvent(
      event(
        "customer.subscription.deleted",
        stripeSubscription({ id: stripeId, status: "canceled", metadata }),
      ),
      ACCOUNT,
    );

    const after = await subRow(stripeId);
    expect(after?.status).toBe("canceled");
    expect(after?.canceledAt).not.toBeNull();
    expect(after?.currentPeriodEnd).toEqual(before?.currentPeriodEnd);
  });

  it("does not let a stale update resurrect a cancelled member", async () => {
    /*
     * Stripe retries deliveries for days, so an `updated` event from before a
     * `deleted` one can land after it. Without the terminal-status guard that
     * retry flips a cancelled member back to active and lets them into a gym
     * they left — and both events are genuine, so nothing would report it.
     */
    const { stripeId, metadata } = await live();

    await handleConnectEvent(
      event(
        "customer.subscription.deleted",
        stripeSubscription({ id: stripeId, status: "canceled", metadata }),
      ),
      ACCOUNT,
    );
    await handleConnectEvent(
      event(
        "customer.subscription.updated",
        stripeSubscription({ id: stripeId, status: "active", metadata }),
      ),
      ACCOUNT,
    );

    expect((await subRow(stripeId))?.status).toBe("canceled");
  });

  it("does not let a late invoice failure resurrect a cancelled member", async () => {
    /*
     * The invoice half of the same hazard. `invoice.payment_failed` is retried
     * for days too, so the last one can land after Stripe has exhausted dunning
     * and cancelled. Writing `past_due` on that cancelled row is worse than the
     * stale update above: access counts `past_due` as open, and the row still
     * carries the future period end Stripe advanced to before giving up — so
     * the member who failed every payment gets the whole unpaid period for
     * free. The handler refuses to move a terminal subscription, and this is
     * the guard that proves it.
     */
    const { order, stripeId, metadata } = await live();

    await handleConnectEvent(
      event(
        "customer.subscription.deleted",
        stripeSubscription({ id: stripeId, status: "canceled", metadata }),
      ),
      ACCOUNT,
    );
    await handleConnectEvent(
      event(
        "invoice.payment_failed",
        stripeInvoice({ id: invoiceId("late"), subscriptionId: stripeId }),
      ),
      ACCOUNT,
    );

    expect((await subRow(stripeId))?.status).toBe("canceled");

    const fresh = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    if (!fresh) throw new Error("order vanished");
    expect(await membershipOpenForOrder(fresh)).toBe(false);
  });
});

describe("a membership's files", () => {
  it("stop downloading when the membership lapses", async () => {
    /*
     * The whole reason entitlement is decided at request time. The token was
     * emailed once and lives in an inbox for good; a member who cancelled in
     * March must not still be taking September's files.
     */
    const shop = await makeShop();
    const product = await makeMembership(shop.id);
    await db.insert(productFiles).values({
      productId: product.id,
      name: "programme.pdf",
      url: "https://example.com/programme.pdf",
    });
    const client = await makeClient(shop.id);
    const order = await makeSignupOrder({
      shopId: shop.id,
      productId: product.id,
      clientId: client.id,
    });
    const stripeId = `sub_${uid().slice(0, 8)}`;
    const metadata = {
      shopId: shop.id,
      productId: product.id,
      clientId: client.id,
      orderId: order.id,
    };

    await handleConnectEvent(
      event("customer.subscription.created", stripeSubscription({ id: stripeId, metadata })),
      ACCOUNT,
    );

    const paying = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    if (!paying) throw new Error("order vanished");
    expect(await membershipOpenForOrder(paying)).toBe(true);

    await handleConnectEvent(
      event(
        "customer.subscription.updated",
        stripeSubscription({
          id: stripeId,
          status: "canceled",
          periodEnd: new Date(Date.now() - 86_400_000),
          metadata,
        }),
      ),
      ACCOUNT,
    );

    const lapsed = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    if (!lapsed) throw new Error("order vanished");
    expect(await membershipOpenForOrder(lapsed)).toBe(false);
  });

  it("leaves every other kind of order alone", async () => {
    // An ordinary digital order must not acquire a membership check that can
    // refuse it.
    const shop = await makeShop();
    const [digital] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Preset pack",
        slug: `d-${uid().slice(0, 8)}`,
        kind: "digital",
        priceCents: 1_200,
        isPublished: true,
      })
      .returning();
    if (!digital) throw new Error("fixture: product was not inserted");

    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        productId: digital.id,
        productTitle: "Preset pack",
        productKind: "digital",
        unitPriceCents: 1_200,
        subtotalCents: 1_200,
        totalCents: 1_200,
        currency: "USD",
        paymentMethod: "card",
        paymentStatus: "paid",
        status: "confirmed",
      })
      .returning();
    if (!order) throw new Error("fixture: order was not inserted");

    expect(await membershipOpenForOrder(order)).toBe(true);
    expect((await accessForOrder(order)).isMembership).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The other half of the feature: memberships on every rail that is not a card.
 *
 * There is no Stripe here at all — no subscription object, no invoice, no
 * webhook. A gym taking cash at the door or a class settling by bank transfer
 * has none of that, and Sailo runs the cycle instead: it raises the next
 * period's order before the current one lapses, and the seller confirming the
 * money is what moves the membership forward.
 *
 * What these assertions defend is that the *rules* did not fork. Access, the
 * grace boundary and cancellation are the same code as the card path reads,
 * and the two failure directions are the same too: a member let in without
 * paying costs the seller a month, and one locked out mid-period costs them
 * the member.
 */
describe("a membership on a manual rail", () => {
  async function manualMember(over: { interval?: string } = {}) {
    const shop = await makeShop();
    const product = await makeMembership(shop.id, {
      billingInterval: over.interval ?? "month",
    });
    const client = await makeClient(shop.id);
    const order = await makeSignupOrder({
      shopId: shop.id,
      productId: product.id,
      clientId: client.id,
    });

    const subscription = await createManualSubscription({
      shop,
      order: {
        id: order.id,
        clientId: client.id,
        productId: product.id,
        paymentMethod: "bank_transfer",
        totalCents: 3_000,
        currency: "USD",
      },
      interval: over.interval ?? "month",
    });
    if (!subscription) throw new Error("fixture: subscription was not written");

    await db
      .update(orders)
      .set({ subscriptionId: subscription.id })
      .where(eq(orders.id, order.id));

    return { shop, product, client, order, subscription };
  }

  const reread = (id: string) =>
    db.query.subscriptions.findFirst({ where: eq(subscriptions.id, id) });

  /** A subscription's period end, or a failed test — never an assertion. */
const periodEndOf = (row: { currentPeriodEnd: Date | null } | undefined): Date => {
  if (!row?.currentPeriodEnd) throw new Error("membership has no period end");
  return row.currentPeriodEnd;
};

const orderRow = (id: string) =>
    db.query.orders.findFirst({ where: eq(orders.id, id) });

  it("gives no access until the seller says the money arrived", async () => {
    /*
     * The whole reason a manual membership starts `incomplete`. Somebody who
     * has *said* they will send a bank transfer has not sent one, and letting
     * them in on the promise is how a gym ends up with members it is not
     * being paid for.
     */
    const { subscription, order } = await manualMember();
    expect(subscription.status).toBe("incomplete");
    expect(subscription.currentPeriodEnd).toBeNull();

    const before = await orderRow(order.id);
    if (!before) throw new Error("order vanished");
    expect(await membershipOpenForOrder(before)).toBe(false);
  });

  it("starts the membership when the order is marked paid", async () => {
    const { subscription, order } = await manualMember();

    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, order.id));
    await extendForPaidOrder(order.id);

    const row = await reread(subscription.id);
    expect(row?.status).toBe("active");
    expect(row?.currentPeriodEnd).not.toBeNull();
    // Roughly a month out, not thirty days and not a year.
    const until = row?.currentPeriodEnd;
    if (!until) throw new Error("membership was not given a period");
    const days = (until.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);

    const paid = await orderRow(order.id);
    if (!paid) throw new Error("order vanished");
    expect(await membershipOpenForOrder(paid)).toBe(true);
  });

  it("extends once however many times the seller toggles the payment", async () => {
    /*
     * There is no webhook here to de-duplicate against, so the marker on the
     * order is the only thing standing between a fumbled dropdown and a
     * member being given three months for one payment.
     */
    const { subscription, order } = await manualMember();

    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, order.id));

    await extendForPaidOrder(order.id);
    const once = await reread(subscription.id);

    await extendForPaidOrder(order.id);
    await extendForPaidOrder(order.id);
    const thrice = await reread(subscription.id);

    expect(thrice?.currentPeriodEnd?.getTime()).toBe(
      once?.currentPeriodEnd?.getTime(),
    );
  });

  it("raises the next period's order before access runs out", async () => {
    const { subscription, order } = await manualMember();
    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, order.id));
    await extendForPaidOrder(order.id);

    // Wind the clock to inside the lead window rather than waiting a month.
    const dueSoon = new Date(
      periodEndOf(await reread(subscription.id)).getTime() -
        (RENEWAL_LEAD_DAYS - 1) * 86_400_000,
    );

    const tick = await runManualRenewals(dueSoon);
    expect(tick.raised).toBeGreaterThanOrEqual(1);

    const raised = await db.query.orders.findMany({
      where: and(
        eq(orders.subscriptionId, subscription.id),
        eq(orders.paymentStatus, "unpaid"),
      ),
    });
    expect(raised).toHaveLength(1);
    // Priced from the subscription, so a seller raising their rates does not
    // silently re-price somebody mid-arrangement.
    expect(raised[0]?.totalCents).toBe(3_000);
    expect(raised[0]?.paymentMethod).toBe("bank_transfer");
    expect(raised[0]?.productKind).toBe("membership");
  });

  it("asks once, however many times the cron runs", async () => {
    const { subscription, order } = await manualMember();
    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, order.id));
    await extendForPaidOrder(order.id);

    const dueSoon = new Date(
      periodEndOf(await reread(subscription.id)).getTime() -
        (RENEWAL_LEAD_DAYS - 1) * 86_400_000,
    );

    await runManualRenewals(dueSoon);
    await runManualRenewals(dueSoon);
    await runManualRenewals(dueSoon);

    const raised = await db.query.orders.findMany({
      where: and(
        eq(orders.subscriptionId, subscription.id),
        eq(orders.paymentStatus, "unpaid"),
      ),
    });
    expect(raised).toHaveLength(1);
  });

  it("keeps the member in while the renewal is outstanding, then closes", async () => {
    /*
     * Being asked is not being overdue. The member is still inside the period
     * they paid for, so the door stays open until it actually ends — and then
     * it closes, because on a manual rail nothing is retrying in the
     * background the way a card is.
     */
    const { subscription, order } = await manualMember();
    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, order.id));
    await extendForPaidOrder(order.id);

    const periodEnd = periodEndOf(await reread(subscription.id));
    await runManualRenewals(new Date(periodEnd.getTime() - 86_400_000));

    // Asked, unpaid, still inside the period.
    const asked = await reread(subscription.id);
    expect(asked?.status).toBe("past_due");
    const signup = await orderRow(order.id);
    if (!signup) throw new Error("order vanished");
    expect(
      await membershipOpenForOrder(signup, new Date(periodEnd.getTime() - 86_400_000)),
    ).toBe(true);

    // And past it, closed.
    expect(
      await membershipOpenForOrder(signup, new Date(periodEnd.getTime() + 86_400_000)),
    ).toBe(false);
  });

  it("carries the renewal on when the seller confirms it", async () => {
    const { subscription, order } = await manualMember();
    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, order.id));
    await extendForPaidOrder(order.id);

    const first = periodEndOf(await reread(subscription.id));
    const dueSoon = new Date(
      first.getTime() - (RENEWAL_LEAD_DAYS - 1) * 86_400_000,
    );
    await runManualRenewals(dueSoon);

    const renewal = await db.query.orders.findFirst({
      where: and(
        eq(orders.subscriptionId, subscription.id),
        eq(orders.paymentStatus, "unpaid"),
      ),
    });
    if (!renewal) throw new Error("no renewal was raised");

    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, renewal.id));
    await extendForPaidOrder(renewal.id);

    const second = await reread(subscription.id);
    expect(second?.status).toBe("active");
    // A second month, measured from the first period's end rather than today,
    // so paying late does not walk the renewal date forward.
    expect(second?.currentPeriodEnd?.getTime()).toBeGreaterThan(first.getTime());
    // And it is asking again, not stuck on the period it already collected.
    expect(second?.renewalOrderedFor).toBeNull();
  });

  it("stops asking once nobody has paid for weeks", async () => {
    const { subscription, order } = await manualMember();
    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, order.id));
    await extendForPaidOrder(order.id);

    const longAfter = new Date(
      periodEndOf(await reread(subscription.id)).getTime() + 40 * 86_400_000,
    );

    const tick = await runManualRenewals(longAfter);
    expect(tick.lapsed).toBeGreaterThanOrEqual(1);
    expect((await reread(subscription.id))?.status).toBe("canceled");
  });

  it("does not ask a member who has already said they are leaving", async () => {
    const { subscription, order } = await manualMember();
    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, order.id));
    await extendForPaidOrder(order.id);

    await db
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(subscriptions.id, subscription.id));

    const dueSoon = new Date(
      periodEndOf(await reread(subscription.id)).getTime() -
        (RENEWAL_LEAD_DAYS - 1) * 86_400_000,
    );
    await runManualRenewals(dueSoon);

    const raised = await db.query.orders.findMany({
      where: and(
        eq(orders.subscriptionId, subscription.id),
        eq(orders.paymentStatus, "unpaid"),
      ),
    });
    expect(raised).toHaveLength(0);
  });

  it("leaves card memberships entirely alone", async () => {
    // The manual cron must never touch a Stripe-billed member: Stripe is
    // charging that card, and raising an order for it would ask somebody to
    // pay twice.
    const shop = await makeShop();
    const product = await makeMembership(shop.id);
    const client = await makeClient(shop.id);
    const order = await makeSignupOrder({
      shopId: shop.id,
      productId: product.id,
      clientId: client.id,
    });
    const stripeId = `sub_${uid().slice(0, 8)}`;
    await handleConnectEvent(
      event(
        "customer.subscription.created",
        stripeSubscription({
          id: stripeId,
          periodEnd: new Date(Date.now() + 86_400_000),
          metadata: {
            shopId: shop.id,
            productId: product.id,
            clientId: client.id,
            orderId: order.id,
          },
        }),
      ),
      ACCOUNT,
    );

    const before = await subRow(stripeId);
    await runManualRenewals(new Date());
    const after = await subRow(stripeId);

    expect(after?.status).toBe(before?.status);
    expect(after?.renewalOrderedFor).toBeNull();
    if (!after) throw new Error("subscription vanished");
    expect(await ordersFor(after.id)).toHaveLength(1);
  });
});

/**
 * The checkout action itself, on a manual rail.
 *
 * The tests above call `createManualSubscription` directly, which proves the
 * renewal cycle and proves nothing about how a membership *gets* one. That
 * gap was not theoretical: the branch that creates the subscription was
 * missing from `createOrderIntent` for a while, so every membership — cash,
 * transfer, chat — was still being sent to a Stripe subscription checkout, and
 * every one of the tests above passed the whole time. Lint caught it, which is
 * not a control anybody should be relying on.
 */
describe("subscribing through the real checkout", () => {
  it("creates the arrangement on a manual rail and grants nothing yet", async () => {
    const shop = await makeShop({
      // No Stripe at all — this is the shop the card path cannot serve.
      stripeAccountId: null,
      stripeChargesEnabled: false,
    });
    await db
      .update(paymentMethods)
      /*
       * `accountName` is the rail's one required field. Without it
       * `isRailUsable` says no and the checkout refuses before it ever reaches
       * the membership branch — which is the rail guard working, not a
       * membership bug, and a fixture that omitted it sent me looking in the
       * wrong place for ten minutes.
       */
      .set({
        type: "bank_transfer",
        config: { bankName: "Test Bank", accountName: "Iron & Oak Ltd" } as never,
      })
      .where(eq(paymentMethods.shopId, shop.id));

    const product = await makeMembership(shop.id);

    const result = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "bank_transfer",
      customerName: "Ada Member",
      customerEmail: "ada@example.com",
      customerPhone: "+15551234567",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, result.orderId),
    });
    expect(order?.paymentStatus).toBe("unpaid");
    expect(order?.subscriptionId).not.toBeNull();
    // A membership always mints a token: it addresses the member's own page,
    // which is where the renewal instructions live.
    expect(order?.downloadToken).not.toBeNull();

    if (!order?.subscriptionId) throw new Error("no subscription was created");
    const row = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, order.subscriptionId),
    });
    expect(row?.billingMode).toBe("manual");
    expect(row?.paymentMethod).toBe("bank_transfer");
    expect(row?.status).toBe("incomplete");
    expect(row?.priceCents).toBe(3_000);
    // Nothing is open until the seller confirms the money.
    expect(await membershipOpenForOrder(order)).toBe(false);
  });

  it("refuses a membership sharing a basket with anything else", async () => {
    const shop = await makeShop({ stripeAccountId: null, stripeChargesEnabled: false });
    await db
      .update(paymentMethods)
      .set({
        type: "bank_transfer",
        config: { accountName: "Iron & Oak Ltd" } as never,
      })
      .where(eq(paymentMethods.shopId, shop.id));

    const membership = await makeMembership(shop.id);
    const [mug] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Mug",
        slug: `mug-${uid().slice(0, 8)}`,
        kind: "physical",
        priceCents: 1_200,
        isPublished: true,
      })
      .returning();
    if (!mug) throw new Error("fixture: product was not inserted");

    const result = await createOrderIntent({
      shopId: shop.id,
      items: [
        { productId: membership.id, quantity: 1 },
        { productId: mug.id, quantity: 1 },
      ],
      paymentMethod: "bank_transfer",
      customerName: "Ada Member",
      customerEmail: "ada@example.com",
      customerPhone: "+15551234567",
      addressLine1: "1 High Street",
      city: "Leeds",
      postalCode: "LS1 1AA",
      country: "UK",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("on its own");
  });
});
