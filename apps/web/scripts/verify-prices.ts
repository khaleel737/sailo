/**
 * Asks the live Stripe account what it will actually charge, then runs the
 * same `priceMismatch` the checkout runs. The unit tests assert the guard
 * against a fixture; this asserts it against reality, which is where the
 * $29.99-for-a-$19.99-plan bug lived.
 */
import Stripe from "stripe";
import { priceMismatch } from "@sailo/billing/checkout";
import { PLANS, platformFeeLabel, type PlanId } from "../src/lib/plans";

async function main() {
  const s = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-07-29.dahlia",
  });
  const map = [
    ["pro", "month", process.env.STRIPE_PRICE_PRO_MONTHLY!],
    ["pro", "year", process.env.STRIPE_PRICE_PRO_YEARLY!],
    ["business", "month", process.env.STRIPE_PRICE_BUSINESS_MONTHLY!],
    ["business", "year", process.env.STRIPE_PRICE_BUSINESS_YEARLY!],
  ] as const;

  let bad = 0;
  for (const [plan, interval, id] of map) {
    const price = await s.prices.retrieve(id);
    const reason = priceMismatch(plan, interval, price);
    const amt = `$${((price.unit_amount ?? 0) / 100).toFixed(2)}`;
    console.log(
      reason
        ? `  FAIL ${plan}/${interval} ${amt} — ${reason}`
        : `  OK   ${plan}/${interval}  ${amt.padStart(8)}  matches plans.ts`,
    );
    if (reason) bad++;
  }

  console.log("\n  fee actually charged, by entitled plan:");
  for (const id of ["free", "pro", "business"] as PlanId[]) {
    const shop = { plan: id, subscriptionStatus: id === "free" ? null : "active" };
    console.log(`    ${PLANS[id].name.padEnd(9)} ${platformFeeLabel(shop)}`);
  }
  process.exit(bad ? 1 : 0);
}

main();
