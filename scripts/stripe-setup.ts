/**
 * Brings the Stripe account in line with `src/lib/plans.ts`, then prints the
 * price ids to put in the environment. Safe to re-run.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/stripe-setup.ts
 *   npx dotenv -e .env.local -- npx tsx scripts/stripe-setup.ts --check
 *
 * `--check` reports drift and exits non-zero without changing anything, so it
 * can gate a release.
 *
 * What it reconciles:
 *
 * - **Names and descriptions.** These are what a seller reads on the Stripe
 *   Checkout page and on their receipt, so they follow the plan definition.
 *   Products carried the old "Shopik" branding long after the rename.
 * - **Amounts.** A Stripe price is immutable, so a changed amount means a new
 *   price and archiving the old one. The previous version of this script
 *   reused any active price for the interval regardless of amount, which is
 *   how Stripe came to charge $29.99 for a plan the app sold at $19.99.
 * - **The billing portal.** Without a saved configuration, opening the portal
 *   throws rather than degrading.
 *
 * Existing subscribers are left on the price they signed up at — Stripe keeps
 * billing them the old amount until they switch. Migrating them is a separate,
 * deliberate act, not a side effect of a deploy.
 */
import Stripe from "stripe";
import { present } from "../src/lib/invariant";
import { PAID_PLAN_IDS, PLANS } from "../src/lib/plans";

const CHECK_ONLY = process.argv.includes("--check");
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://sailo.store";

/** Metadata key before the Shopik → Sailo rename. */
const LEGACY_KEY = "shopik_plan";
const KEY = "sailo_plan";

const drift: string[] = [];
const note = (msg: string) => {
  drift.push(msg);
  console.log(`  ${CHECK_ONLY ? "DRIFT" : "FIXED"}  ${msg}`);
};

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

  const mode = key.startsWith("sk_live_") ? "LIVE" : "test";
  console.log(`Stripe ${mode} mode — ${APP_URL}\n`);

  const env: string[] = [];
  /** Carried to the portal step so it doesn't re-search mid-rename. */
  const resolved: { product: string; prices: string[] }[] = [];

  for (const planId of PAID_PLAN_IDS) {
    const plan = present(PLANS[planId], "PLANS[planId]");
    console.log(`${plan.name}`);

    // Look under the current key first, then the pre-rename one, so an account
    // set up before the rename is adopted rather than duplicated.
    const found =
      (await stripe.products.search({ query: `metadata['${KEY}']:'${planId}'`, limit: 1 }))
        .data[0] ??
      (await stripe.products.search({ query: `metadata['${LEGACY_KEY}']:'${planId}'`, limit: 1 }))
        .data[0];

    let product = found;
    if (!product) {
      if (CHECK_ONLY) {
        note(`no product for ${planId}`);
        continue;
      }
      product = await stripe.products.create({
        name: `Sailo ${plan.name}`,
        description: plan.tagline,
        metadata: { [KEY]: planId },
      });
      note(`created product ${product.id}`);
    } else {
      const wantName = `Sailo ${plan.name}`;
      const patch: Stripe.ProductUpdateParams = {};
      if (product.name !== wantName) {
        patch.name = wantName;
        note(`product name "${product.name}" → "${wantName}"`);
      }
      if (product.description !== plan.tagline) {
        patch.description = plan.tagline;
        note(`product description → "${plan.tagline}"`);
      }
      if (product.metadata[KEY] !== planId || product.metadata[LEGACY_KEY]) {
        patch.metadata = { [KEY]: planId, [LEGACY_KEY]: "" };
        note(`product metadata → ${KEY}=${planId}`);
      }
      if (Object.keys(patch).length && !CHECK_ONLY) {
        product = await stripe.products.update(product.id, patch);
      }
    }
    console.log(`  product ${product.id}`);

    const planPrices: string[] = [];

    for (const [interval, amount] of [
      ["month", plan.monthlyCents],
      ["year", plan.yearlyCents],
    ] as const) {
      const active = await stripe.prices.list({
        product: product.id,
        active: true,
        recurring: { interval },
        limit: 100,
      });

      // Only a price at exactly the advertised amount, in USD, is usable.
      let price = active.data.find(
        (p) => p.unit_amount === amount && p.currency === "usd",
      );

      const stale = active.data.filter((p) => p.id !== price?.id);

      if (!price) {
        const wrong = stale
          .map((p) => `${p.id} at $${((p.unit_amount ?? 0) / 100).toFixed(2)}`)
          .join(", ");
        note(
          `${interval}ly price should be $${(amount / 100).toFixed(2)}` +
            (wrong ? ` — found ${wrong}` : " — missing"),
        );
        if (CHECK_ONLY) continue;

        price = await stripe.prices.create({
          product: product.id,
          currency: "usd",
          unit_amount: amount,
          recurring: { interval },
          metadata: { [KEY]: planId, sailo_interval: interval },
        });
      }

      // Archive anything left over so a stale id can't be charged by mistake.
      for (const old of stale) {
        if (CHECK_ONLY) {
          note(`${interval}ly price ${old.id} should be archived`);
          continue;
        }
        await stripe.prices.update(old.id, { active: false });
        note(`archived stale ${interval}ly price ${old.id}`);
      }

      console.log(
        `  ${interval}ly  ${price.id}  $${((price.unit_amount ?? 0) / 100).toFixed(2)}`,
      );
      planPrices.push(price.id);
      env.push(
        `STRIPE_PRICE_${planId.toUpperCase()}_${interval.toUpperCase()}LY=${price.id}`,
      );
    }

    // Monthly is what the pricing table leads with, so make it the default.
    const monthly = env
      .find((line) => line.startsWith(`STRIPE_PRICE_${planId.toUpperCase()}_MONTHLY=`))
      ?.split("=")[1];
    if (monthly && product.default_price !== monthly) {
      if (CHECK_ONLY) note(`default price should be ${monthly}`);
      else {
        await stripe.products.update(product.id, { default_price: monthly });
        note(`default price → ${monthly}`);
      }
    }
    resolved.push({ product: product.id, prices: planPrices });
    console.log("");
  }

  // --- billing portal -----------------------------------------------------
  // Without a saved configuration, `billingPortal.sessions.create` throws.
  console.log("Billing portal");
  const configs = await stripe.billingPortal.configurations.list({ limit: 10 });
  const portalProducts = resolved.filter((r) => r.prices.length > 0);

  const settings: Stripe.BillingPortal.ConfigurationCreateParams = {
    business_profile: {
      headline: "Sailo — one link, your whole shop",
      // No privacy/terms URLs: Sailo has no such pages yet, and linking the
      // portal at a 404 is worse than leaving the row off.
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      // At period end, not immediately — they've paid for the rest of the month.
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "switched_service", "unused", "other"],
        },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: portalProducts,
      },
    },
    default_return_url: `${APP_URL}/admin/settings/billing`,
  };

  const existing = configs.data.find((c) => c.is_default) ?? configs.data[0];
  if (!existing) {
    note("no billing portal configuration — the portal would throw");
    if (!CHECK_ONLY) {
      const created = await stripe.billingPortal.configurations.create(settings);
      console.log(`  created ${created.id}`);
    }
  } else if (!CHECK_ONLY) {
    const updated = await stripe.billingPortal.configurations.update(existing.id, settings);
    console.log(`  ${updated.id} up to date`);
  } else {
    console.log(`  ${existing.id}`);
  }

  // --- webhook endpoint ---------------------------------------------------
  const WEBHOOK_URL = `${APP_URL}/api/stripe/webhook`;
  const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
  ];

  console.log("\nWebhook");
  const endpoints = await stripe.webhookEndpoints.list({ limit: 50 });
  const endpoint = endpoints.data.find((e) => e.url === WEBHOOK_URL);

  if (!endpoint) {
    note(`no endpoint for ${WEBHOOK_URL}`);
    if (!CHECK_ONLY) {
      const created = await stripe.webhookEndpoints.create({
        url: WEBHOOK_URL,
        enabled_events: EVENTS,
        description: "Sailo subscription lifecycle",
      });
      console.log(`  created ${created.id}`);
      console.log(`\n  Put this in STRIPE_WEBHOOK_SECRET:\n  ${created.secret}\n`);
    }
  } else {
    const missing = EVENTS.filter((e) => !endpoint.enabled_events.includes(e));
    if (missing.length) {
      note(`endpoint is missing events: ${missing.join(", ")}`);
      if (!CHECK_ONLY) {
        await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: EVENTS });
      }
    }
    if (endpoint.status !== "enabled") note(`endpoint is ${endpoint.status}`);
    console.log(`  ${endpoint.id} → ${endpoint.url} (${endpoint.status})`);
  }

  console.log("\nEnvironment:\n");
  console.log(env.join("\n"));

  if (CHECK_ONLY && drift.length) {
    console.log(`\n${drift.length} difference(s) between Stripe and plans.ts`);
    process.exit(1);
  }
  console.log(CHECK_ONLY ? "\nStripe matches plans.ts" : "\nDone");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
