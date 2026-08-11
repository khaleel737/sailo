/**
 * Which payment methods a buyer is actually offered, per country and currency.
 *
 *   npm run check:methods
 *
 * Sailo never names payment methods in code — that is deliberate, and it is
 * what lets a Dutch buyer see iDEAL and a Polish one see Przelewy24 without a
 * deploy. Stripe calls it dynamic payment methods and decides from the
 * currency, the buyer, the amount and the connected account's own settings.
 *
 * Because nothing about that is visible in our source, the only way to know it
 * works is to ask Stripe. This creates a connected account per country, opens a
 * real Checkout Session on each the way `createCheckoutSession` does, and reads
 * back the list Stripe would render.
 *
 * It also proves the thing that silently breaks every non-card method: they
 * settle *after* checkout, so the order is only ever paid by a later
 * `checkout.session.async_payment_succeeded`.
 */
import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
const stripe = new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * The markets worth proving, and the method each is known for. Sailo sells in
 * 18 currencies; these are the ones where *not* offering the local method is
 * the difference between a sale and an abandoned basket.
 */
const MARKETS = [
  { country: "NL", currency: "eur", expect: "ideal", label: "Netherlands" },
  { country: "BE", currency: "eur", expect: "bancontact", label: "Belgium" },
  { country: "DE", currency: "eur", expect: "sepa_debit", label: "Germany" },
  { country: "PL", currency: "pln", expect: "p24", label: "Poland" },
  { country: "GB", currency: "gbp", expect: "bacs_debit", label: "United Kingdom" },
  { country: "US", currency: "usd", expect: "card", label: "United States" },
] as const;

/** Methods that confirm later rather than at checkout. */
const DELAYED = new Set([
  "sepa_debit",
  "bacs_debit",
  "boleto",
  "oxxo",
  "konbini",
  "customer_balance",
  "sofort",
  "acss_debit",
  "au_becs_debit",
]);

/**
 * Bank details Stripe accepts in test mode, per country. A connected account
 * cannot be charged on until it has one, and the local methods stay invisible
 * until it can be charged on — which is why an unonboarded account reports
 * nothing but `card` no matter what the Dashboard says.
 */
type TestBankAccount = Stripe.AccountUpdateParams['external_account'];

const BANK: Record<string, TestBankAccount> = {
  US: { object: "bank_account", country: "US", currency: "usd", routing_number: "110000000", account_number: "000123456789" },
  NL: { object: "bank_account", country: "NL", currency: "eur", account_number: "NL39RABO0300065264" },
  BE: { object: "bank_account", country: "BE", currency: "eur", account_number: "BE62510007547061" },
  DE: { object: "bank_account", country: "DE", currency: "eur", account_number: "DE89370400440532013000" },
  PL: { object: "bank_account", country: "PL", currency: "pln", account_number: "PL61109010140000071219812874" },
  // The API takes `sort_code` for GB; the SDK's union doesn't model it.
  GB: { object: "bank_account", country: "GB", currency: "gbp", account_number: "00012345", routing_number: "108800" },
};

const ADDRESS: Record<string, Stripe.AddressParam> = {
  US: { line1: "address_full_match", city: "SF", state: "CA", postal_code: "94103", country: "US" },
  NL: { line1: "address_full_match", city: "Amsterdam", postal_code: "1011AB", country: "NL" },
  BE: { line1: "address_full_match", city: "Brussels", postal_code: "1000", country: "BE" },
  DE: { line1: "address_full_match", city: "Berlin", postal_code: "10115", country: "DE" },
  PL: { line1: "address_full_match", city: "Warsaw", postal_code: "00-001", country: "PL" },
  GB: { line1: "address_full_match", city: "London", postal_code: "EC1A 1BB", country: "GB" },
};

/** Creates the account and takes it all the way to chargeable. */
async function onboardedAccount(country: string) {
  const account = await stripe.accounts.create({
    type: "custom",
    country,
    business_profile: {
      name: `Methods ${country}`,
      product_description: "Throwaway account for npm run check:methods.",
      mcc: "5734",
      url: "https://sailo.store",
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { probe: "check-methods" },
  });

  await stripe.accounts.update(account.id, {
    business_type: "individual",
    individual: {
      first_name: "Jenny",
      last_name: "Rosen",
      dob: { day: 1, month: 1, year: 1990 },
      address: ADDRESS[country],
      email: "jenny@example.com",
      phone: "0000000000",
      ...(country === "US" ? { ssn_last_4: "0000", id_number: "000000000" } : {}),
    },
    external_account: BANK[country],
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "8.8.8.8" },
  });

  return account.id;
}

async function reportConfiguration() {
  const list = await stripe.paymentMethodConfigurations.list({ limit: 5 });
  for (const config of list.data) {
    const on: string[] = [];
    const off: string[] = [];
    for (const [key, value] of Object.entries(config)) {
      const preference = (value as { display_preference?: { value?: string } })
        ?.display_preference;
      if (!preference) continue;
      (preference.value === "on" ? on : off).push(key);
    }
    console.log(
      `Payment methods${config.is_default ? " (default configuration)" : ` — ${config.name}`}`,
    );
    console.log(`  on  (${on.length}): ${on.join(", ") || "(none)"}`);
    console.log(`  off (${off.length}): ${off.join(", ") || "(none)"}`);
    console.log(
      "  Turning one on here is what makes it appear at checkout — no deploy needed.\n",
    );
  }
}

async function main() {
  await reportConfiguration();
  console.log("Creating a connected account per market…\n");

  const created: string[] = [];
  try {
    for (const market of MARKETS) {
      let accountId: string;
      try {
        accountId = await onboardedAccount(market.country);
        created.push(accountId);
      } catch (error) {
        check(
          `${market.label}: connected account`,
          false,
          (error as Error).message.slice(0, 120),
        );
        continue;
      }

      // Stripe verifies asynchronously; the local methods only appear once the
      // account can actually take a charge.
      let live = await stripe.accounts.retrieve(accountId);
      for (let i = 0; i < 20 && !live.charges_enabled; i++) {
        await sleep(2500);
        live = await stripe.accounts.retrieve(accountId);
      }

      /*
       * The same call `createCheckoutSession` makes: no `payment_method_types`,
       * so Stripe picks. Passing that parameter is the single most common way
       * to accidentally restrict a store to cards — the skill's rule, and the
       * reason this test exists.
       */
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: market.currency,
                  unit_amount: 2400,
                  product_data: { name: "Speckled stoneware mug" },
                },
              },
            ],
            success_url: "https://sailo.store/ok",
            cancel_url: "https://sailo.store/no",
          },
          { stripeAccount: accountId },
        );
      } catch (error) {
        check(
          `${market.label} (${market.currency.toUpperCase()}): session`,
          false,
          (error as Error).message.slice(0, 140),
        );
        continue;
      }

      const offered = session.payment_method_types ?? [];
      console.log(`${market.label} · ${market.currency.toUpperCase()} · charges ${live.charges_enabled ? "enabled" : "PENDING"}`);
      console.log(`  offered: ${offered.join(", ") || "(none)"}`);

      // A market with nothing to pay with is broken. Which methods appear
      // beyond that is a Dashboard decision, so it is reported, not asserted —
      // failing a suite because someone chose not to sell via iDEAL yet would
      // be noise, and noise is how a real failure gets ignored.
      check(
        `${market.label}: buyers get at least one way to pay`,
        offered.length > 0,
      );
      if (!offered.includes(market.expect)) {
        console.log(
          `  note: ${market.expect} not offered — check it is on in the payment method configuration`,
        );
      }

      const delayed = offered.filter((m) => DELAYED.has(m));
      if (delayed.length) {
        console.log(
          `  settles after checkout: ${delayed.join(", ")} — these confirm via checkout.session.async_payment_succeeded`,
        );
      }
      console.log();
    }

    /* ------------------------------------------------------------------ */
    console.log("What our own code sends");
    const source = await import("node:fs").then((fs) =>
      fs.promises.readFile("src/lib/connect.ts", "utf8"),
    );
    check(
      "createCheckoutSession never pins payment_method_types",
      !source.includes("payment_method_types"),
      "pinning it would restrict every shop to the methods hardcoded here",
    );

    console.log("\nDelayed settlement is handled");
    const webhook = await import("node:fs").then((fs) =>
      fs.promises.readFile("src/lib/stripe-webhooks.ts", "utf8"),
    );
    check(
      "checkout.session.async_payment_succeeded is handled",
      webhook.includes("checkout.session.async_payment_succeeded"),
      "without it iDEAL and SEPA orders stay unpaid forever",
    );
    check(
      "checkout.session.async_payment_failed is handled",
      webhook.includes("checkout.session.async_payment_failed"),
      "without it a failed settlement never releases its stock",
    );
  } finally {
    console.log("\nCleanup");
    for (const account of (await stripe.accounts.list({ limit: 50 })).data) {
      if (account.metadata?.probe === "check-methods") {
        await stripe.accounts.del(account.id);
        console.log(`  deleted ${account.id}`);
      }
    }
    await sleep(200);
  }

  console.log(
    failures === 0
      ? `\nAll ${checks} checks passed.`
      : `\n${failures} of ${checks} checks failed.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
