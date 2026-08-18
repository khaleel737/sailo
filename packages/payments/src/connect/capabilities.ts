/*
 * No `server-only`, unlike its neighbours in this package.
 *
 * Nothing here reads the environment, the database or the ambient Stripe
 * client — every call takes the client as an argument, which is what lets
 * `check:connect` exercise the real table against a sandbox rather than
 * asserting against a copy of it that can drift.
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
 *
 * This table is only half the answer, and the smaller half. It says what Sailo
 * *wants*; `listCapabilities` says what the account can actually have, and the
 * two disagree often enough that trusting this one alone is what hid the two
 * bugs described on `classify` below.
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
 *
 * Measured against a sandbox rather than reasoned about: accounts opened in
 * NL, DE, AT, BE, FR and PL were each asked for all five of the rails this set
 * once held, one at a time so no refusal could mask another. SEPA, iDEAL and
 * Bancontact came back `active` in every one of the six — the paragraph above
 * is not a hope, it is measured. The other two did not, and are gone:
 *
 *  - **EPS** was `rejected.other` in all six, *including Austria*, the one
 *    country it is named after. A rail its own home rejects is not a country
 *    question, and requesting it bought nothing anywhere.
 *  - **P24** was `rejected.unsupported_business` everywhere except Poland,
 *    where it is obtainable but wants `business_profile.url` and
 *    `company.vat_id` on top. It has moved to `DOMESTIC` accordingly.
 *
 * Both refusals arrived as a *successful* `accounts.update` followed by a
 * capability sitting at `inactive` for ever, which is exactly the shape of
 * failure `classify` exists to make visible.
 */
const EUROPEAN: readonly string[] = [
  "sepa_debit_payments",
  "ideal_payments",
  "bancontact_payments",
];

/**
 * Domestic-only rails, where the seller's own country really is the question.
 *
 * P24 sits here rather than in `EUROPEAN` on the evidence above: outside
 * Poland Stripe does not merely leave it inactive, it rejects it as an
 * unsupported business, and a rejection we ask for on every European
 * onboarding is a support ticket waiting to be filed.
 */
const DOMESTIC: Record<string, readonly string[]> = {
  GB: ["bacs_debit_payments"],
  PL: ["blik_payments", "p24_payments"],
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

/**
 * What Stripe currently says about one capability on one account.
 *
 * `status` is Stripe's own word for it. The two that matter and are easy to
 * conflate are `inactive`, which can mean either "waiting for the seller" or
 * "refused for ever" depending entirely on `disabledReason`, and
 * `unrequested`, which is the state every capability starts in and which
 * carries a usable `disabledReason` *before* anything has been asked for —
 * Stripe will tell you a rail needs `business_profile.support_email` without
 * being asked for the rail first.
 */
export type CapabilityFacts = {
  name: string;
  status: string;
  /** Why it isn't active, in Stripe's words. A `rejected.*` value is final. */
  disabledReason: string | null;
  /** What the seller has still to supply. Empty when nothing is outstanding. */
  currentlyDue: string[];
};

/**
 * Everything Stripe knows about every capability on an account, in one call.
 *
 * `GET /v1/accounts/{id}/capabilities` returns the lot — forty-two of them on
 * a current account, with `has_more: false` — each with its status and its own
 * requirements. That is the difference between this file guessing and this
 * file knowing, and it is why the country table above is now only the *want*
 * half of the decision.
 *
 * The alternative was one `GET .../capabilities/{name}` per rail, which is the
 * same information for eight times the round trips.
 */
export async function listCapabilities(
  stripe: Stripe,
  accountId: string,
): Promise<Map<string, CapabilityFacts>> {
  const facts = new Map<string, CapabilityFacts>();

  const page = await stripe.accounts.listCapabilities(accountId);
  for (const capability of page.data) {
    const requirements = capability.requirements;
    facts.set(capability.id, {
      name: capability.id,
      status: capability.status,
      disabledReason: requirements?.disabled_reason ?? null,
      currentlyDue: requirements?.currently_due ?? [],
    });
  }

  return facts;
}

/**
 * Whether Stripe has already refused this rail for good.
 *
 * `rejected.*` is Stripe's prefix for a decision rather than a delay —
 * `rejected.unsupported_business`, `rejected.other` — and re-requesting one on
 * every visit to the payments screen is a round trip that can only ever
 * produce the same answer. Anything else, including a bare `inactive`, is
 * worth asking for again.
 */
function isRejected(facts: CapabilityFacts | undefined): boolean {
  return Boolean(facts?.disabledReason?.startsWith("rejected."));
}

export type CapabilityOutcome = {
  /** Capabilities Stripe accepted the request for. */
  requested: string[];
  /** Capabilities Stripe refused, with why. Never a reason to fail the caller. */
  refused: { name: string; reason: string }[];
  /** Capabilities skipped because Stripe has already refused them for good. */
  skipped: string[];
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
 * `known`, when supplied, is what `listCapabilities` last said. It is used for
 * one thing: dropping rails Stripe has already rejected outright, so a shop in
 * the Netherlands stops re-asking for P24 on every page load and — more to the
 * point — one permanent rejection stops dragging the whole batch into the slow
 * per-capability path on every single visit.
 *
 * Never throws. A seller pressing Connect is not helped by an error about
 * BLIK, and every capability here is an extra: the account still takes cards
 * with all of them refused. Refusals come back so the caller can log them.
 */
export async function requestCapabilities(
  stripe: Stripe,
  accountId: string,
  names: readonly string[],
  known?: Map<string, CapabilityFacts>,
): Promise<CapabilityOutcome> {
  const skipped = known ? names.filter((n) => isRejected(known.get(n))) : [];
  const wanted = skipped.length ? names.filter((n) => !skipped.includes(n)) : names;

  if (wanted.length === 0) return { requested: [], refused: [], skipped };

  try {
    await stripe.accounts.update(accountId, { capabilities: asParams(wanted) });
    return { requested: [...wanted], refused: [], skipped };
  } catch {
    // Fall through: one of them is unavailable here and the batch cannot say
    // which, so ask one at a time and find out.
  }

  const requested: string[] = [];
  const refused: { name: string; reason: string }[] = [];

  for (const name of wanted) {
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

  return { requested, refused, skipped };
}

/**
 * What a rail is doing, in the four states a seller can act on differently.
 *
 * The distinction this type exists to draw is between the two middle values.
 * `blocked` is the seller's move and names the fields; `pending` is Stripe's
 * and there is nothing to do but wait. Collapsing them — which is what storing
 * a bare boolean does — is how iDEAL sat switched off on Dutch accounts for
 * want of one identity field that nobody was ever told about.
 */
export type RailState = "live" | "blocked" | "pending" | "unavailable";

export type RailReport = {
  capability: string;
  state: RailState;
  /** Named fields the seller must supply. Only ever populated on `blocked`. */
  currentlyDue: string[];
  /** Stripe's own reason, kept verbatim for the log. */
  reason: string | null;
};

/**
 * Turns Stripe's status vocabulary into the four states above.
 *
 * The two bugs this exists to catch, both of which shipped and neither of
 * which produced a single error:
 *
 * One: **an accepted request is not an active capability.** `ideal_payments`
 * on a Dutch account is accepted immediately and then sits at `inactive` with
 * `currently_due: ["individual.id_number"]` until the seller supplies it.
 * `requestCapabilities` reported that as a success, because as a request it
 * was one. iDEAL was off, the seller was never asked for the field, and the
 * only symptom was Dutch buyers not being offered the rail every Dutch buyer
 * expects.
 *
 * Two: **a rejection can arrive without a failed request.** `eps_payments` and
 * `p24_payments` came back from a *successful* `accounts.update` and settled
 * at `inactive` with a `rejected.*` reason. `refused` was empty, nothing was
 * logged, and the country table went on asking for them for ever.
 *
 * `unrequested` is `unavailable` rather than an error state of its own: it
 * means Sailo never asked, which for a rail outside `capabilitiesFor` is the
 * correct and intended outcome.
 */
export function classify(facts: CapabilityFacts | undefined): RailReport {
  if (!facts) {
    return { capability: "", state: "unavailable", currentlyDue: [], reason: null };
  }

  const base = { capability: facts.name, reason: facts.disabledReason };

  if (facts.status === "active") {
    return { ...base, state: "live", currentlyDue: [] };
  }

  if (isRejected(facts) || facts.status === "unrequested") {
    return { ...base, state: "unavailable", currentlyDue: [] };
  }

  if (facts.currentlyDue.length > 0) {
    return { ...base, state: "blocked", currentlyDue: [...facts.currentlyDue] };
  }

  return { ...base, state: "pending", currentlyDue: [] };
}
