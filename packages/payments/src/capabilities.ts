/*
 * No `server-only`, unlike its neighbours in this package.
 *
 * Nothing here reads the environment, the database or the ambient Stripe
 * client — `requestCapabilities` takes the client as an argument, which is
 * what lets `check:connect` exercise the real table against a sandbox rather
 * than asserting against a copy of it that can drift.
 */
import type Stripe from "stripe";
import { EEA } from "@sailo/core/countries";

/**
 * What a connected account is allowed to take money through, by where it is.
 *
 * This used to be two frozen objects in `connect.ts` — a base pair and three
 * wallets — and both the shape and the values were wrong in ways that only
 * showed up outside the United States.
 *
 * **The values.** Sailo creates Express accounts, and Stripe is explicit about
 * what that costs: "For connected accounts that don't have access to the full
 * Stripe Dashboard, which includes Express and Custom accounts, you must
 * request payment method capabilities for them." A capability nobody requests
 * is a payment method no buyer is ever offered, whatever the Dashboard says
 * and whatever `payment_method_types` does or doesn't pin. Requesting only
 * `card_payments` therefore meant a German shop could take a card and nothing
 * else — no SEPA, no iDEAL for the Dutch buyer, no Bancontact for the Belgian
 * one — and nothing anywhere reported that, because it isn't an error. It is
 * an absence.
 *
 * **The shape.** The three wallets went up in a single `accounts.update`, and
 * two of them are United States only. Stripe rejects the whole request when
 * one member of it is unavailable:
 *
 *     The cashapp_payments capability is not requestable for accounts in DE.
 *
 * The caller caught that and shrugged, so a German seller silently lost Link
 * as well — a wallet that works perfectly well in Germany — because it shared
 * a request with Cash App. Hence `requestCapabilities` below: one batch while
 * the batch works, one call per capability the moment it doesn't.
 *
 * Deliberately not here, and not by oversight:
 *
 *  - **Klarna, Affirm, Afterpay.** They decide eligibility on the account's
 *    merchant category code and `business_profile` sets no `mcc`, so
 *    requesting them buys the onboarding questions and none of the payments.
 *    They also finance a purchase, and nobody finances a $45 cake.
 *  - **PayPal and Venmo.** Not obtainable at all on this integration. Stripe
 *    supports PayPal only for businesses in Europe, does not support it on
 *    direct charges, and states plainly that it "isn't available for platforms
 *    that onboard other businesses and enable them to accept payments
 *    directly" — which is exactly what Sailo is. Venmo has no Stripe support
 *    anywhere. Both ship as manual rails instead; see `PAYMENT_METHOD_DEFS`.
 *
 * Every entry costs the seller something. Stripe's own warning is that "the
 * capabilities you request for a connected account determine the information
 * you're required to collect for it", so a rail earns its place by being one a
 * seller in that country is actually asked for.
 */

/** Everywhere. Apple Pay and Google Pay need no entry — they ride `card_payments`. */
const BASE: readonly string[] = ["card_payments", "transfers"];

/**
 * Stripe's own wallet. Available far more widely than the two below it, which
 * is the entire reason it must not share a request with them.
 */
const EVERYWHERE: readonly string[] = ["link_payments"];

/** United States only. Stripe refuses both outright for an account elsewhere. */
const UNITED_STATES: readonly string[] = [
  "cashapp_payments",
  "us_bank_account_ach_payments",
];

/**
 * The European set, requested for any European seller rather than only for the
 * one country each method is named after.
 *
 * This is the part that is easy to get wrong. iDEAL is a Dutch payment method,
 * but the account that needs `ideal_payments` is the *seller's*, and a German
 * shop with Dutch customers is the ordinary case — Sailo sells across a border
 * by default. Scoping each capability to its home country would give the
 * German seller cards for their Dutch buyers and call it correct.
 */
const EUROPEAN: readonly string[] = [
  "sepa_debit_payments",
  "ideal_payments",
  "bancontact_payments",
  "p24_payments",
  "eps_payments",
];

/** Domestic-only rails, where the seller's own country really is the question. */
const DOMESTIC: Record<string, readonly string[]> = {
  GB: ["bacs_debit_payments"],
  PL: ["blik_payments"],
};

/** The EEA plus the two European countries outside it that Stripe still serves. */
const EUROPEAN_COUNTRIES = new Set<string>([...EEA, "CH", "GB"]);

/**
 * Everything worth asking Stripe for, for an account in this country.
 *
 * `country` is nullable because an account can be read back before Stripe has
 * assigned one. Unknown means the base pair and Link: correct for everyone,
 * wrong for nobody, and re-run on the next visit once the country is known.
 */
export function capabilitiesFor(country: string | null | undefined): string[] {
  const code = country?.toUpperCase() ?? "";
  return [
    ...BASE,
    ...EVERYWHERE,
    ...(code === "US" ? UNITED_STATES : []),
    ...(EUROPEAN_COUNTRIES.has(code) ? EUROPEAN : []),
    ...(DOMESTIC[code] ?? []),
  ];
}

/** The two an account cannot take a single card payment without. */
export function baseCapabilities(): Stripe.AccountCreateParams.Capabilities {
  return asParams(BASE);
}

function asParams(names: readonly string[]): Stripe.AccountCreateParams.Capabilities {
  return Object.fromEntries(
    names.map((name) => [name, { requested: true }]),
  ) as Stripe.AccountCreateParams.Capabilities;
}

export type CapabilityOutcome = {
  /** Capabilities Stripe accepted the request for. */
  requested: string[];
  /** Capabilities Stripe refused, with why. Never a reason to fail the caller. */
  refused: { name: string; reason: string }[];
};

/**
 * Requests a set of capabilities, and does not let one refusal cost the rest.
 *
 * The batch goes first because it is one round trip and it succeeds whenever
 * the country map above is right. The per-capability pass is what happens when
 * it isn't — Stripe changes which countries can have what, and the failure
 * mode of being slightly out of date should be losing that one capability, not
 * losing every capability that travelled with it.
 *
 * Never throws. A seller pressing Connect is not helped by an error about
 * BLIK, and every capability here is an extra: the account still takes cards
 * with all of them refused. Refusals come back so the caller can log them.
 */
export async function requestCapabilities(
  stripe: Stripe,
  accountId: string,
  names: readonly string[],
): Promise<CapabilityOutcome> {
  if (names.length === 0) return { requested: [], refused: [] };

  try {
    await stripe.accounts.update(accountId, { capabilities: asParams(names) });
    return { requested: [...names], refused: [] };
  } catch {
    // Fall through: one of them is unavailable here and the batch cannot say
    // which, so ask one at a time and find out.
  }

  const requested: string[] = [];
  const refused: { name: string; reason: string }[] = [];

  for (const name of names) {
    try {
      await stripe.accounts.update(accountId, { capabilities: asParams([name]) });
      requested.push(name);
    } catch (error) {
      refused.push({
        name,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return { requested, refused };
}
