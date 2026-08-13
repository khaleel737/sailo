/**
 * Everything Sailo sells, as Stripe holds it.
 *
 *   npm run check:plans                       # test mode, from .env.local
 *   STRIPE_SECRET_KEY=sk_live_… npx tsx scripts/check-plans.ts    # live
 *
 * Lists every product and price in the account with its description, then
 * checks the four prices the app is configured to charge against `lib/plans.ts`.
 *
 * Worth running against live before launch and after any pricing change. The
 * checkout action already refuses to send anyone to a price that disagrees with
 * the plan table — this says *why* before a seller finds out by being unable to
 * upgrade, and it catches the other half: a price that is fine but archived, or
 * a product quietly deleted from the Dashboard.
 */
import Stripe from "stripe";
import { PLANS } from "../src/lib/plans";
import { present } from "@sailo/core/invariant";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
const stripe = new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia" });

const money = (cents: number | null, currency: string) =>
  cents === null ? "—" : `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;

let problems = 0;

async function main() {
  // The script exits above without a key, but binding it here is what makes
  // that visible to the compiler rather than asserted at the point of use.
  const key = present(secretKey, "STRIPE_SECRET_KEY");
  const live = !key.includes("_test_");
  console.log(`Stripe account — ${live ? "LIVE" : "TEST"} mode\n`);

  /* ------------------------------------------- everything in the account */
  const products = await stripe.products.list({ limit: 100 });
  const prices = await stripe.prices.list({ limit: 100, expand: ["data.product"] });

  console.log(`Products (${products.data.length})`);
  for (const product of products.data) {
    const own = prices.data.filter(
      (p) => (typeof p.product === "string" ? p.product : p.product.id) === product.id,
    );
    console.log(`\n  ${product.name}${product.active ? "" : "   ARCHIVED"}`);
    console.log(`    id:          ${product.id}`);
    console.log(`    description: ${product.description ?? "(none)"}`);
    if (product.marketing_features?.length) {
      console.log(
        `    features:    ${product.marketing_features.map((f) => f.name).join(", ")}`,
      );
    }
    if (own.length === 0) {
      console.log("    prices:      none — nothing can be sold at this product");
    }
    for (const price of own) {
      const recurring = price.recurring
        ? `every ${price.recurring.interval_count ?? 1} ${price.recurring.interval}`
        : "one-off";
      console.log(
        `    price:       ${money(price.unit_amount, price.currency)} ${recurring}` +
          `${price.active ? "" : "   ARCHIVED"}  ${price.id}`,
      );
    }
  }

  /* -------------------------------- what the app is configured to charge */
  console.log("\n\nWhat this deployment is configured to charge");

  const wanted = [
    { key: "STRIPE_PRICE_PRO_MONTHLY", plan: PLANS.pro, cents: PLANS.pro.monthlyCents, interval: "month" },
    { key: "STRIPE_PRICE_PRO_YEARLY", plan: PLANS.pro, cents: PLANS.pro.yearlyCents, interval: "year" },
    { key: "STRIPE_PRICE_BUSINESS_MONTHLY", plan: PLANS.business, cents: PLANS.business.monthlyCents, interval: "month" },
    { key: "STRIPE_PRICE_BUSINESS_YEARLY", plan: PLANS.business, cents: PLANS.business.yearlyCents, interval: "year" },
  ];

  for (const want of wanted) {
    const id = process.env[want.key];
    if (!id) {
      problems++;
      console.log(`\n  ${want.key}\n    NOT SET — ${want.plan.name} cannot be bought at this interval`);
      continue;
    }

    let price: Stripe.Price;
    try {
      price = await stripe.prices.retrieve(id);
    } catch (error) {
      problems++;
      console.log(
        `\n  ${want.key}\n    ${id}\n    GONE — ${(error as Error).message.slice(0, 100)}`,
      );
      continue;
    }

    const faults: string[] = [];
    if (!price.active) faults.push("archived");
    if (price.currency !== "usd") faults.push(`currency is ${price.currency}`);
    if (price.unit_amount !== want.cents) {
      faults.push(`charges ${money(price.unit_amount, price.currency)}, plans.ts says ${money(want.cents, "usd")}`);
    }
    if (price.recurring?.interval !== want.interval) {
      faults.push(`bills ${price.recurring?.interval ?? "one-off"}, expected ${want.interval}`);
    }
    if (faults.length) problems++;

    console.log(
      `\n  ${want.key}\n    ${id}\n    ${faults.length ? `MISMATCH — ${faults.join("; ")}` : `OK — ${money(price.unit_amount, price.currency)} / ${want.interval}`}`,
    );
  }

  console.log(
    problems === 0
      ? "\n\nEvery configured price is live and matches lib/plans.ts."
      : `\n\n${problems} problem(s). A seller hitting one of these cannot upgrade — the checkout action refuses to charge a price that disagrees with what they were shown.`,
  );
  if (problems > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
