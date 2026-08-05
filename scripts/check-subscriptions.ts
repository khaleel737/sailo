/**
 * Sailo's own billing — a seller paying us — end to end.
 *
 *   npm run check:subs
 *
 * The connected-account harnesses prove buyers can pay sellers. This proves the
 * other direction, which is where our revenue actually comes from and which
 * until now had never run against a real shop: every subscription event in
 * earlier testing arrived for a customer that didn't exist and took the
 * `if (!shopId) break` path, so the mapping was never exercised at all.
 *
 * A brand-new account signs up, subscribes to Pro on a real Stripe
 * subscription, upgrades to Business, has a renewal fail, and cancels — with
 * the real events replayed into the real account webhook after each step, and
 * the entitlements checked against `planFor` the way the product checks them.
 */
import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { can, planFor, productLimit } from "@/lib/plans";

const secretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const SECRET: string = webhookSecret;
const stripe = new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia" });
const sql = neon(databaseUrl);
const BASE = process.env.CHECK_BASE ?? "http://localhost:3000";
const ROUTE = "/api/stripe/webhook";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok
        ? ""
        : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`),
  );
}

/** Posts a real Stripe event to the real account endpoint, signed. */
async function deliver(event: unknown) {
  const body = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: SECRET,
  });
  const response = await fetch(`${BASE}${ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body,
  });
  const text = await response.text();
  return { status: response.status, raw: text.slice(0, 200) };
}

/** The event Stripe emitted for a subscription, once it has caught up. */
async function eventFor(type: string, subscriptionId: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const list = await stripe.events.list({ type, limit: 30 });
    const found = list.data.find((e) => {
      const object = e.data.object as { id?: string; subscription?: string };
      return object.id === subscriptionId || object.subscription === subscriptionId;
    });
    if (found) return found;
    await sleep(1500);
  }
  return null;
}

const shopRow = async (id: string) => {
  const [row] = await sql`
    select plan, subscription_status, subscription_interval, current_period_end,
           cancel_at_period_end, stripe_subscription_id, stripe_customer_id, comp_plan
    from shops where id = ${id}`;
  if (!row) throw new Error(`the fixture shop ${id} vanished mid-run`);
  return row;
};

/** What the product would actually let this shop do right now. */
const entitlements = (row: Record<string, unknown>) => {
  const shape = {
    plan: String(row.plan),
    subscriptionStatus: (row.subscription_status as string | null) ?? null,
    compPlan: (row.comp_plan as string | null) ?? null,
  };
  return {
    entitledTo: planFor(shape).name,
    cardRails: can(shape, "cardRails"),
    coupons: can(shape, "coupons"),
    affiliates: can(shape, "affiliates"),
    csvExport: can(shape, "csvExport"),
    removeBadge: can(shape, "removeBadge"),
    products: productLimit(shape),
  };
};

async function main() {
  console.log(`Account webhook: ${BASE}${ROUTE}\n`);

  const owner = `check-subs-${randomUUID().slice(0, 8)}`;
  const handle = `subs-${randomUUID().slice(0, 8)}`;
  let customerId: string | null = null;
  let shopId = "";

  try {
    /* ------------------------------------------------- a brand-new signup */
    console.log("A new account signs up");
    await sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${owner}, 'Subs Check', ${`${owner}@sailo.local`}, true, now(), now())`;
    const [shop] = await sql`
      insert into shops (user_id, handle, name, currency, plan, is_published)
      values (${owner}, ${handle}, 'Subs Check Shop', 'USD', 'free', true)
      returning id`;
    if (!shop) throw new Error("the fixture shop was not created");
    shopId = shop.id as string;

    let row = await shopRow(shopId);
    check("starts on the free plan", row.plan, "free");
    check(
      "free entitlements",
      entitlements(row),
      {
        entitledTo: "Free",
        cardRails: false,
        coupons: false,
        affiliates: false,
        csvExport: false,
        removeBadge: false,
        products: 20,
      },
    );

    /* ------------------------------------------------------ subscribe: Pro */
    console.log("\nThey subscribe to Pro (monthly)");
    const customer = await stripe.customers.create({
      name: "Subs Check Shop",
      email: `${owner}@sailo.local`,
      metadata: { shopId, handle },
      // A card that always succeeds, attached as the default.
      payment_method: "pm_card_visa",
      invoice_settings: { default_payment_method: "pm_card_visa" },
    });
    customerId = customer.id;
    await sql`update shops set stripe_customer_id = ${customer.id} where id = ${shopId}`;

    const proMonthly = process.env.STRIPE_PRICE_PRO_MONTHLY;
    if (!proMonthly) throw new Error("STRIPE_PRICE_PRO_MONTHLY is not set");

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: proMonthly }],
      metadata: { shopId, plan: "pro" },
    });
    check("Stripe created the subscription", subscription.status, "active");

    const created = await eventFor("customer.subscription.created", subscription.id);
    check("Stripe emitted customer.subscription.created", Boolean(created), true);
    if (created) {
      const result = await deliver(created);
      check("webhook accepted it", result.status, 200);

      row = await shopRow(shopId);
      check("shop is on Pro", row.plan, "pro");
      check("status recorded", row.subscription_status, "active");
      check("interval recorded", row.subscription_interval, "month");
      check("subscription id stored", row.stripe_subscription_id, subscription.id);
      check("renewal date stored", Boolean(row.current_period_end), true);
      check(
        "Pro entitlements",
        entitlements(row),
        {
          entitledTo: "Pro",
          cardRails: false,
          coupons: false,
          affiliates: false,
          csvExport: true,
          removeBadge: true,
          products: 250,
        },
      );
    }

    /* ------------------------------------------------ upgrade to Business */
    console.log("\nThey upgrade to Business (yearly)");
    const businessYearly = process.env.STRIPE_PRICE_BUSINESS_YEARLY;
    if (!businessYearly) throw new Error("STRIPE_PRICE_BUSINESS_YEARLY is not set");

    const item = subscription.items.data[0];
    if (!item) throw new Error("the subscription has no line to upgrade");
    const upgraded = await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: businessYearly }],
      proration_behavior: "none",
    });
    check("Stripe switched the price", upgraded.items.data[0]?.price.id, businessYearly);

    const updated = await eventFor("customer.subscription.updated", subscription.id);
    check("Stripe emitted customer.subscription.updated", Boolean(updated), true);
    if (updated) {
      await deliver(updated);
      row = await shopRow(shopId);
      check("shop is on Business", row.plan, "business");
      check("interval is now yearly", row.subscription_interval, "year");
      check(
        "Business entitlements — the card rail unlocks",
        entitlements(row),
        {
          entitledTo: "Business",
          cardRails: true,
          coupons: true,
          affiliates: true,
          csvExport: true,
          removeBadge: true,
          products: null,
        },
      );
    }

    /* --------------------------------------------------- a renewal fails */
    console.log("\nA renewal fails");
    await deliver({
      id: `evt_${randomUUID().replace(/-/g, "")}`,
      object: "event",
      api_version: "2026-07-29.dahlia",
      created: Math.floor(Date.now() / 1000),
      type: "invoice.payment_failed",
      data: { object: { object: "invoice", customer: customer.id } },
    });
    row = await shopRow(shopId);
    check("marked past due", row.subscription_status, "past_due");
    check(
      "still entitled — Stripe is still retrying, the shop stays up",
      entitlements(row).cardRails,
      true,
    );

    /* ----------------------------------------------------------- cancelled */
    console.log("\nThey cancel");
    await stripe.subscriptions.cancel(subscription.id);
    const deleted = await eventFor("customer.subscription.deleted", subscription.id);
    check("Stripe emitted customer.subscription.deleted", Boolean(deleted), true);
    if (deleted) {
      await deliver(deleted);
      row = await shopRow(shopId);
      check("back to free", row.plan, "free");
      check("status cleared", row.subscription_status, null);
      check("subscription id cleared", row.stripe_subscription_id, null);
      check(
        "entitlements revoked",
        entitlements(row),
        {
          entitledTo: "Free",
          cardRails: false,
          coupons: false,
          affiliates: false,
          csvExport: false,
          removeBadge: false,
          products: 20,
        },
      );
    }

    /* ------------------------------------------------- a comp outranks it */
    console.log("\nA comped plan survives all of that");
    await sql`update shops set comp_plan = 'business' where id = ${shopId}`;
    row = await shopRow(shopId);
    check(
      "comped shop is entitled to Business despite a cancelled subscription",
      entitlements(row).entitledTo,
      "Business",
    );
    await sql`update shops set comp_plan = null where id = ${shopId}`;

    /* ------------------------------------------------------- idempotency */
    console.log("\nStripe redelivers");
    if (created) {
      const replay = await deliver(created);
      check("replay is a no-op, not an error", replay.status, 200);
      check("still free after the replay", (await shopRow(shopId))?.plan, "free");
    }
  } finally {
    console.log("\nCleanup");
    if (shopId) await sql`delete from "user" where id = ${owner}`;
    if (customerId) {
      await stripe.customers.del(customerId).catch(() => {});
      console.log(`  deleted customer ${customerId}`);
    }
    console.log("  fixture shop removed");
  }

  console.log(
    failures === 0
      ? `\nAll ${checks} checks passed. Sailo's own billing works end to end.`
      : `\n${failures} of ${checks} checks failed.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
