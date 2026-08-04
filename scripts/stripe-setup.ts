/**
 * Creates (or reuses) the Shopik products and prices in Stripe, then prints the
 * price ids to put in .env.local. Safe to re-run — it looks products up by a
 * `shopik_plan` metadata key rather than creating duplicates.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/stripe-setup.ts
 */
import Stripe from "stripe";
import { PAID_PLAN_IDS, PLANS } from "../src/lib/plans";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

  const env: string[] = [];

  for (const planId of PAID_PLAN_IDS) {
    const plan = PLANS[planId];

    // Find an existing product for this plan before making another.
    const search = await stripe.products.search({
      query: `metadata['shopik_plan']:'${planId}'`,
      limit: 1,
    });

    const product =
      search.data[0] ??
      (await stripe.products.create({
        name: `Shopik ${plan.name}`,
        description: plan.tagline,
        metadata: { shopik_plan: planId },
      }));
    console.log(`${plan.name}: product ${product.id}`);

    for (const [interval, amount] of [
      ["month", plan.monthlyCents],
      ["year", plan.yearlyCents],
    ] as const) {
      const existing = await stripe.prices.list({
        product: product.id,
        active: true,
        recurring: { interval },
        limit: 1,
      });

      const price =
        existing.data[0] ??
        (await stripe.prices.create({
          product: product.id,
          currency: "usd",
          unit_amount: amount,
          recurring: { interval },
          metadata: { shopik_plan: planId, shopik_interval: interval },
        }));

      console.log(
        `  ${interval}ly  ${price.id}  $${(price.unit_amount ?? 0) / 100}`,
      );
      env.push(
        `STRIPE_PRICE_${planId.toUpperCase()}_${interval.toUpperCase()}LY=${price.id}`,
      );
    }
  }

  console.log("\nAdd these to .env.local:\n");
  console.log(env.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
