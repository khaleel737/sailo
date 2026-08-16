/**
 * The real thing: live Stripe, the deployed site, no money.
 *
 *   STRIPE_SECRET_KEY=sk_live_… npx tsx scripts/check-live.ts
 *
 * Everything else in this repo tests against test-mode Stripe and a server on
 * localhost. That proves the code. It does not prove the *deployment* — that
 * the live keys are the right keys, that the live signing secret in Vercel
 * matches the live endpoint, that the live prices exist, that Stripe can reach
 * sailo.store and that the row comes back changed.
 *
 * So this subscribes a throwaway shop to the real Pro plan on the real account
 * with a 100%-off coupon, and waits for the live webhook to arrive on its own.
 * Nothing is charged. Everything it creates in Stripe and in the database is
 * deleted at the end, including the coupon.
 *
 * If this passes, the billing path is live. If the webhook secret in Vercel is
 * wrong, this is what tells you — the subscription will exist at Stripe and the
 * shop row will never move.
 */
import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import {
  checkoutSessionParams,
  priceEnvKey,
  priceMismatch,
} from "@sailo/billing/checkout";
import { appUrl } from "../src/lib/app-url";

const secretKey = process.env.STRIPE_SECRET_KEY;
const databaseUrl = process.env.DATABASE_URL;
if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
if (!secretKey.startsWith("sk_live_")) {
  throw new Error("This check is for live mode. Pass a live key deliberately.");
}

const stripe = new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia" });
const sql = neon(databaseUrl);
const SITE = process.env.CHECK_SITE ?? "https://sailo.store";

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

/** Polls the shop row until the webhook has landed, or gives up. */
async function waitForShop(
  shopId: string,
  predicate: (row: Record<string, unknown>) => boolean,
  seconds = 60,
) {
  for (let i = 0; i < seconds; i++) {
    const [row] = await sql`
      select plan, subscription_status, subscription_interval,
             stripe_subscription_id, cancel_at_period_end
      from shops where id = ${shopId}`;
    if (row && predicate(row)) return row;
    await sleep(1000);
  }
  const [row] = await sql`
    select plan, subscription_status, stripe_subscription_id
    from shops where id = ${shopId}`;
  return row ?? null;
}

async function main() {
  console.log(`LIVE mode · ${SITE}\n`);

  const owner = `live-check-${randomUUID().slice(0, 8)}`;
  const handle = `live-check-${randomUUID().slice(0, 8)}`;
  let customerId: string | null = null;
  let couponId: string | null = null;
  let shopId = "";

  try {
    /* ------------------------------------------------- the deployment is up */
    console.log("The deployed site");
    const account = await fetch(`${SITE}/api/stripe/webhook`, { method: "POST" });
    check("account webhook is reachable and demands a signature", account.status, 400);
    const connect = await fetch(`${SITE}/api/stripe/connect/webhook`, { method: "POST" });
    check("connect webhook is reachable and demands a signature", connect.status, 400);

    /* ------------------------------------------------------ a throwaway shop */
    console.log("\nA shop signs up");
    await sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${owner}, 'Live Check', ${`${owner}@sailo.local`}, true, now(), now())`;
    const [shop] = await sql`
      insert into shops (user_id, handle, name, currency, plan, is_published)
      values (${owner}, ${handle}, 'Live Check Shop', 'USD', 'free', false)
      returning id`;
    if (!shop) throw new Error("could not create the fixture shop");
    shopId = shop.id as string;
    check("starts free", (await waitForShop(shopId, () => true, 1))?.plan, "free");

    /* ------------------------------------------ the button a seller presses */
    /*
     * This section is the reason the file exists in its current shape.
     *
     * Everything below subscribes with `subscriptions.create`, which is how
     * Stripe's own webhooks get exercised — but it is not what the upgrade
     * button does. The button calls `checkout.sessions.create`, and for days
     * that call 400'd on the live account while every test here passed and
     * every local run passed, because nothing anywhere created a live Checkout
     * Session. Managed Payments is on by default on this account and rejects
     * `adaptive_pricing[enabled]=false`; the test account has it off, so the
     * two accounts disagreed about a default and only production found out.
     *
     * The parameters come from `checkoutSessionParams`, the same builder the
     * server action uses, so this cannot drift into checking a different call.
     * A session that is never completed costs nothing, and it is expired
     * immediately afterwards rather than left open.
     */
    console.log("\nThey press Upgrade — the real Checkout Session, live");
    for (const interval of ["month", "year"] as const) {
      const priceId = process.env[priceEnvKey("pro", interval)];
      if (!priceId) {
        check(`${priceEnvKey("pro", interval)} is set`, false, true);
        continue;
      }

      const stripePrice = await stripe.prices.retrieve(priceId);
      check(
        `the live ${interval}ly price matches the pricing table`,
        priceMismatch("pro", interval, stripePrice),
        null,
      );

      const probeCustomer = await stripe.customers.create({
        name: "Sailo live check (checkout probe)",
        metadata: { shopId, handle },
      });
      try {
        const session = await stripe.checkout.sessions.create(
          checkoutSessionParams({
            shopId,
            plan: "pro",
            price: priceId,
            customer: probeCustomer.id,
            returnTo: {
              success: `${appUrl()}/admin/settings/billing?checkout=success`,
              cancelled: `${appUrl()}/admin/settings/billing?checkout=cancelled`,
            },
          }),
        );
        check(`Stripe returns a ${interval}ly checkout URL`, Boolean(session.url), true);
        await stripe.checkout.sessions.expire(session.id).catch(() => {});
      } finally {
        await stripe.customers.del(probeCustomer.id).catch(() => {});
      }
    }

    /* -------------------------------------- a real subscription, at no cost */
    console.log("\nThey subscribe to Pro — on a 100% off coupon, so nothing is charged");
    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: "forever",
      name: "Sailo live check (delete me)",
    });
    couponId = coupon.id;

    const customer = await stripe.customers.create({
      name: "Live Check Shop",
      email: `${owner}@sailo.local`,
      metadata: { shopId, handle },
    });
    customerId = customer.id;
    await sql`update shops set stripe_customer_id = ${customer.id} where id = ${shopId}`;

    const price = process.env.STRIPE_PRICE_PRO_MONTHLY;
    if (!price) throw new Error("STRIPE_PRICE_PRO_MONTHLY is not set");

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price }],
      discounts: [{ coupon: coupon.id }],
      metadata: { shopId, plan: "pro" },
    });
    check("Stripe activated it without taking money", subscription.status, "active");

    const latest = subscription.latest_invoice;
    if (typeof latest === "string") {
      const invoice = await stripe.invoices.retrieve(latest);
      check("the invoice really was zero", invoice.amount_paid, 0);
    }

    /*
     * Nothing is replayed here. Stripe delivers to the live endpoint, over the
     * internet, to the deployed site, which writes to this database — the whole
     * chain, exactly as it will happen for a paying seller.
     */
    console.log("\nWaiting for the live webhook to arrive on its own…");
    const afterSubscribe = await waitForShop(shopId, (r) => r.plan === "pro");
    check("the deployed site recorded the subscription", afterSubscribe?.plan, "pro");
    check("status", afterSubscribe?.subscription_status, "active");
    check("interval", afterSubscribe?.subscription_interval, "month");
    check(
      "subscription id stored",
      afterSubscribe?.stripe_subscription_id,
      subscription.id,
    );

    /* ------------------------------------------------ cancel at period end */
    console.log("\nThey ask to cancel at the end of the period");
    await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
    const afterFlag = await waitForShop(shopId, (r) => r.cancel_at_period_end === true);
    check("the cancellation is reflected", afterFlag?.cancel_at_period_end, true);
    check("but access continues until it ends", afterFlag?.plan, "pro");

    /* ------------------------------------------------------- cancel now */
    console.log("\nThey cancel outright");
    await stripe.subscriptions.cancel(subscription.id);
    const afterCancel = await waitForShop(shopId, (r) => r.plan === "free");
    check("back to free", afterCancel?.plan, "free");
    check("status cleared", afterCancel?.subscription_status, null);
    check("subscription id cleared", afterCancel?.stripe_subscription_id, null);
  } finally {
    console.log("\nCleanup");
    if (shopId) {
      await sql`delete from "user" where id = ${owner}`;
      console.log("  shop removed");
    }
    if (customerId) {
      await stripe.customers.del(customerId).catch(() => {});
      console.log(`  customer ${customerId} deleted`);
    }
    if (couponId) {
      await stripe.coupons.del(couponId).catch(() => {});
      console.log(`  coupon ${couponId} deleted`);
    }
  }

  console.log(
    failures === 0
      ? `\nAll ${checks} checks passed against LIVE Stripe and the deployed site.`
      : `\n${failures} of ${checks} checks failed.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
