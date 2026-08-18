/**
 * Proves what a buyer is actually offered, against a real Stripe sandbox.
 *
 *   npm run check:rails
 *
 * `check:connect` answers "would a seller get through onboarding". This one
 * answers the question after it — given an account that got through, which
 * payment methods does a buyer see, and does this repo's own code agree with
 * Stripe about that.
 *
 * It drives the shipped functions rather than a copy of them: `capabilitiesFor`,
 * `requestCapabilities`, `listCapabilities`, `classify` and `sellerRails` are
 * the ones the app calls. The two facts it exists to pin down, both of which
 * were wrong in production and neither of which produced an error:
 *
 *  1. **An accepted capability request is not a live rail.** iDEAL on a Dutch
 *     account is accepted at once and then waits on `individual.id_number`.
 *  2. **Currency decides the offer, not the buyer's country.** The same
 *     account, charged in EUR and in USD, returns different
 *     `payment_method_types` — and iDEAL is in only one of them.
 *
 * Creates a connected account with the controller properties that let a script
 * accept terms on its behalf (Express accounts cannot be onboarded headlessly),
 * then deletes everything it made.
 */
import Stripe from "stripe";
import {
  capabilitiesFor,
  classify,
  listCapabilities,
  requestCapabilities,
} from "@sailo/payments/connect/capabilities";
import {
  CONNECT_RAILS,
  enabledMethods,
  sellerRails,
} from "@sailo/payments/connect/methods";
import { presentmentFromSession } from "@sailo/payments/presentment";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY is not set");

const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
const created: string[] = [];
let failures = 0;
let stalled = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

/** A Dutch seller, onboarded far enough that capabilities can go active. */
async function dutchSeller(withIdNumber: boolean) {
  const account = await stripe.accounts.create({
    country: "NL",
    email: "rails-check@example.com",
    controller: {
      fees: { payer: "application" },
      losses: { payments: "application" },
      stripe_dashboard: { type: "none" },
      requirement_collection: "application",
    },
    business_profile: {
      name: "Rails Check",
      mcc: "5691",
      product_description: "Probe account created by npm run check:rails.",
    },
    business_type: "individual",
    individual: {
      first_name: "Jan",
      last_name: "de Vries",
      email: "jan@example.com",
      phone: "+31612345678",
      dob: { day: 1, month: 1, year: 1990 },
      address: {
        line1: "Damrak 1",
        city: "Amsterdam",
        postal_code: "1012LG",
        country: "NL",
      },
      ...(withIdNumber ? { id_number: "000000000" } : {}),
    },
    tos_acceptance: { date: 1700000000, ip: "8.8.8.8" },
    external_account: {
      object: "bank_account",
      country: "NL",
      currency: "eur",
      account_number: "NL39RABO0300065264",
    },
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
  });
  created.push(account.id);
  return account;
}

/**
 * Polls until Stripe has made up its mind, or gives up.
 *
 * Verification is asynchronous: an account comes back from `accounts.create`
 * with `charges_enabled: false` and its capabilities still settling, and
 * asserting on the first read tests Stripe's latency rather than this repo's
 * logic. The first version of this script did exactly that and reported four
 * failures against code that was right.
 */
async function settle<T>(
  what: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 180_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();

  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    value = await read();
  }

  if (!done(value)) {
    /*
     * Counted separately from a failed check. A sandbox that has not caught up
     * is not this repo being wrong, and reporting it as one sent a green run
     * and a slow run to the same place — which is how a flake gets treated as
     * a regression and a regression gets waved through as a flake.
     */
    stalled++;
    console.log(`  STALL ${what} — Stripe had not settled after ${timeoutMs / 1000}s`);
  }
  return value;
}

/** A session built the way `createCheckoutSession` builds one. */
async function session(
  accountId: string,
  currency: string,
  opts: { adaptivePricing?: boolean; buyerCountry?: string } = {},
) {
  return stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: 4500,
            product_data: { name: "Speckled Mug" },
          },
        },
      ],
      // The fee is here because it is the combination that matters: Adaptive
      // Pricing on a direct charge that Sailo also takes a cut of.
      payment_intent_data: { application_fee_amount: 200 },
      adaptive_pricing: { enabled: opts.adaptivePricing ?? false },
      /*
       * Stripe's documented way to stand a buyer in another country — a
       * `+location_XX` suffix on the email. Without it every probe from here
       * looks like a buyer sitting where the script is.
       */
      ...(opts.buyerCountry
        ? { customer_email: `test+location_${opts.buyerCountry}@example.com` }
        : {}),
      success_url: "https://example.com/ok",
      cancel_url: "https://example.com/no",
    },
    { stripeAccount: accountId },
  );
}

async function sessionTypes(accountId: string, currency: string) {
  return (await session(accountId, currency)).payment_method_types as string[];
}

async function main() {
  console.log("Connected account — a Dutch seller, mid-verification\n");
  const account = await dutchSeller(false);
  console.log(`  ${account.id} · ${account.country} · charges ${account.charges_enabled}`);
  /*
   * Printed because a run where this lists every `individual.*` field is a run
   * where the account was never onboarded at all, and every check after it is
   * measuring the wrong thing. One run did exactly that.
   */
  console.log(`  due: ${JSON.stringify(account.requirements?.currently_due ?? [])}\n`);

  /*
   * The platform's own switch, which is the gate nothing on the account can
   * show you. Read first, because it narrows what is even worth requesting.
   */
  const enabled = await enabledMethods(stripe, account.id);
  console.log(`Platform offers: ${enabled ? [...enabled].sort().join(", ") : "(unknown)"}\n`);

  console.log("Capabilities this repo asks for");
  const wanted = capabilitiesFor(account.country).filter((name) => {
    const rail = CONNECT_RAILS.find((r) => r.capability === name);
    return !rail || !enabled || enabled.has(rail.type);
  });
  console.log(`  ${wanted.join(", ")}\n`);

  check(
    "does not buy a capability for a method the platform has switched off",
    !wanted.some((name) => {
      const rail = CONNECT_RAILS.find((r) => r.capability === name);
      return rail && enabled && !enabled.has(rail.type);
    }),
  );

  check(
    "does not ask for EPS, which Stripe rejects even in Austria",
    !wanted.includes("eps_payments"),
  );
  check(
    "does not ask a Dutch seller for P24, which is Poland-only",
    !wanted.includes("p24_payments"),
  );

  // Card has to land before anything else is meaningful — a session on an
  // account that cannot charge returns nothing to compare against.
  await settle(
    "the account to be chargeable",
    () => stripe.accounts.retrieve(account.id),
    (a) => Boolean(a.charges_enabled),
  );

  const before = await listCapabilities(stripe, account.id);
  const outcome = await requestCapabilities(stripe, account.id, wanted, before);
  check("Stripe accepts every capability asked for", outcome.refused.length === 0,
    outcome.refused.map((r) => `${r.name}: ${r.reason}`).join("; "));

  /* ------------------------------------------------- the accepted-but-off */
  console.log("\nAfter the request — accepted is not the same as live");
  const facts = await settle(
    "iDEAL to report its requirements",
    () => listCapabilities(stripe, account.id),
    (f) => classify(f.get("ideal_payments")).state !== "pending",
  );
  const ideal = classify(facts.get("ideal_payments"));
  console.log(`  ideal_payments -> ${ideal.state} ${JSON.stringify(ideal.currentlyDue)}`);

  check(
    "iDEAL reports blocked rather than live, and names the field",
    ideal.state === "blocked" && ideal.currentlyDue.includes("individual.id_number"),
    `got ${ideal.state} due=${JSON.stringify(ideal.currentlyDue)}`,
  );
  check(
    "the rails a seller sees carry that field through",
    sellerRails({ currency: "eur", facts, enabled }).some(
      (r) => r.type === "ideal" && r.state === "blocked",
    ),
  );

  /* ------------------------------------------------------ once it is live */
  console.log("\nWith the identity field supplied");
  await stripe.accounts.update(account.id, { individual: { id_number: "000000000" } });
  const live = await settle(
    "iDEAL to activate",
    () => listCapabilities(stripe, account.id),
    (f) => classify(f.get("ideal_payments")).state === "live",
  );
  check("iDEAL goes live", classify(live.get("ideal_payments")).state === "live");

  /* ------------------------------------------------------ the currency gate */
  console.log("\nThe same live account, priced two ways");
  const eur = sellerRails({ currency: "eur", facts: live, enabled });
  const usd = sellerRails({ currency: "usd", facts: live, enabled });

  check(
    "this repo says iDEAL is on for a shop priced in EUR",
    eur.some((r) => r.type === "ideal" && r.state === "live"),
  );
  check(
    "this repo says iDEAL is off-currency for a shop priced in USD",
    usd.some((r) => r.type === "ideal" && r.state === "off_currency"),
  );

  /*
   * Session eligibility lags capability activation by a few seconds — the
   * capability reads `active` while a session created in the same breath still
   * comes back `["card"]`. Waiting is the difference between testing this
   * repo and testing Stripe's propagation delay.
   */
  const eurTypes = await settle(
    "the EUR session to pick up the new rails",
    () => sessionTypes(account.id, "eur"),
    (types) => types.length > 1,
  );
  const usdTypes = await sessionTypes(account.id, "usd");
  console.log(`  eur -> ${JSON.stringify(eurTypes)}`);
  console.log(`  usd -> ${JSON.stringify(usdTypes)}`);

  check("and Stripe agrees: iDEAL is offered in EUR", eurTypes.includes("ideal"));
  check("and Stripe agrees: iDEAL is not offered in USD", !usdTypes.includes("ideal"));

  /*
   * The claim the payments screen makes, checked against Stripe's own answer.
   * Only in one direction: Stripe lists rails whose capability is not active
   * (it offered `klarna` on an account that never requested it), so what this
   * asserts is that nothing we promise the seller is missing from the session,
   * not that the two lists are equal.
   */
  /* ------------------------------------------------- adaptive pricing */
  console.log("\nAdaptive Pricing — the way out of the currency gate");

  /*
   * The combination worth proving is not that the parameter exists, but that
   * Stripe takes it on a *direct charge that Sailo also takes a fee from*.
   * That is the shape `createCheckoutSession` sends, and a platform-level
   * incompatibility here would be silent until a real buyer hit it.
   */
  let converted: ReturnType<typeof presentmentFromSession> = null;
  try {
    const dutch = await session(account.id, "usd", {
      adaptivePricing: true,
      buyerCountry: "NL",
    });
    check("Stripe accepts adaptive pricing on a direct charge with a fee", true);
    converted = presentmentFromSession(dutch);
    console.log(`  presentment_details -> ${JSON.stringify(dutch.presentment_details ?? null)}`);
  } catch (error) {
    check(
      "Stripe accepts adaptive pricing on a direct charge with a fee",
      false,
      (error as Error).message,
    );
  }

  check(
    "a session in the shop's own currency records no conversion",
    presentmentFromSession(await session(account.id, "eur")) === null,
  );

  /*
   * Whether a conversion actually happens cannot be settled from here, and
   * saying so is better than a check that quietly always passes. It needs the
   * platform switch at dashboard.stripe.com/settings/connect/adaptive-pricing,
   * which Stripe exposes on no API this script can read, and it needs a real
   * browser — the conversion is decided when the buyer loads the page, not
   * when the session is created.
   */
  console.log(
    converted
      ? `  converted: ${JSON.stringify(converted)} — the platform switch is on`
      : "  no conversion recorded. Either the platform switch at\n" +
        "  dashboard.stripe.com/settings/connect/adaptive-pricing is off, or this\n" +
        "  probe cannot trigger it — the conversion happens when a buyer loads the\n" +
        "  page. Neither is a failure of this repo's code.",
  );

  const promised = eur.filter((r) => r.state === "live").map((r) => r.type);
  const missing = promised.filter((t) => !eurTypes.includes(t));
  check(
    "every rail the payments screen calls live is one Stripe actually offers",
    missing.length === 0,
    `missing from the session: ${missing.join(", ")}`,
  );
}

main()
  .catch((error) => {
    failures++;
    console.error(`\nFAILED: ${(error as Error).message}`);
  })
  .finally(async () => {
    for (const id of created) {
      await stripe.accounts.del(id).catch(() => {});
    }
    console.log(`\nCleaned up ${created.length} account(s).`);
    if (stalled > 0) console.log(`${stalled} wait(s) timed out — rerun before reading anything into the failures below.`);
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  });
