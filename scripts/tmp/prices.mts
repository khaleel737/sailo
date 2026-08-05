import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-07-29.dahlia" });

const EXPECTED = {
  STRIPE_PRICE_PRO_MONTHLY:      { plan: "Pro",      cents: 999,   interval: "month" },
  STRIPE_PRICE_PRO_YEARLY:       { plan: "Pro",      cents: 9590,  interval: "year"  },
  STRIPE_PRICE_BUSINESS_MONTHLY: { plan: "Business", cents: 1999,  interval: "month" },
  STRIPE_PRICE_BUSINESS_YEARLY:  { plan: "Business", cents: 19190, interval: "year"  },
};

let bad = 0;
for (const [key, want] of Object.entries(EXPECTED)) {
  const id = process.env[key];
  if (!id) { console.log(`MISSING  ${key} — not set in .env.local`); bad++; continue; }
  try {
    const p = await stripe.prices.retrieve(id, { expand: ["product"] });
    const product = p.product as Stripe.Product;
    const ok =
      p.active &&
      p.currency === "usd" &&
      p.unit_amount === want.cents &&
      p.recurring?.interval === want.interval;
    if (!ok) bad++;
    console.log(
      `${ok ? "OK      " : "MISMATCH"} ${key}\n` +
      `           ${id}\n` +
      `           product: ${product.name}${product.active ? "" : " (ARCHIVED)"}\n` +
      `           ${(p.unit_amount ?? 0) / 100} ${p.currency.toUpperCase()} / ${p.recurring?.interval ?? "one-off"}` +
      `${p.active ? "" : "  ARCHIVED PRICE"}\n` +
      `           want: ${want.cents / 100} USD / ${want.interval}`,
    );
  } catch (e) {
    bad++;
    console.log(`GONE     ${key}\n           ${id}\n           ${(e as Error).message.slice(0, 120)}`);
  }
}
console.log(bad === 0 ? "\nAll four prices are live and match lib/plans.ts." : `\n${bad} price(s) need attention.`);
