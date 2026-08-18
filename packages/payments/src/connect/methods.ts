/*
 * What a buyer can actually press, as opposed to what the account is allowed
 * to offer. The two are different questions and conflating them is the whole
 * reason this file exists.
 *
 * `capabilities.ts` answers "may this seller take iDEAL". This one answers
 * "will any buyer ever be shown it", and the second answer is No far more
 * often than the first, because of the currency rule below.
 *
 * No `server-only` and no Stripe client, for the same reason as its neighbour:
 * everything here is a pure function of facts fetched elsewhere, so the tests
 * and `check:connect` can drive it directly.
 */
import type Stripe from "stripe";
import { classify, type CapabilityFacts, type RailState } from "./capabilities";

/**
 * A rail Stripe can put on the checkout, and what has to be true for it.
 *
 * `currencies` is the field that matters and the one that is easy to leave
 * out. Stripe decides the payment methods on a Checkout Session from the
 * session's **presentment currency**, not from where the buyer is: a shop
 * priced in USD does not offer iDEAL to a Dutch buyer, and a shop priced in
 * EUR offers it to everyone Stripe thinks is Dutch. Measured, not assumed —
 * the same connected account asked for a session in each currency comes back
 * with different `payment_method_types`:
 *
 *     eur -> ['card', 'bancontact', 'ideal', 'link']
 *     usd -> ['card', 'link', 'cashapp']
 *
 * An empty list means the rail travels with any currency the account supports.
 */
export type ConnectRail = {
  /** The capability that switches it on. */
  capability: string;
  /** What Stripe calls it in `payment_method_types`. */
  type: string;
  /** What a seller calls it. Not translated: these are brand names. */
  label: string;
  /** Presentment currencies a buyer can be offered it in. Empty means any. */
  currencies: readonly string[];
};

/**
 * The rails Sailo requests, in the order a seller reads them: the two that
 * work everywhere first, then the ones tied to a currency.
 *
 * Kept beside `capabilitiesFor` rather than derived from it because the
 * mapping is not one-to-one — `transfers` is a capability with no rail, Apple
 * Pay and Google Pay are rails with no capability of their own (they ride
 * `card_payments`, which is why they are not listed separately here).
 */
export const CONNECT_RAILS: readonly ConnectRail[] = [
  { capability: "card_payments", type: "card", label: "Card", currencies: [] },
  { capability: "link_payments", type: "link", label: "Link", currencies: [] },
  { capability: "sepa_debit_payments", type: "sepa_debit", label: "SEPA Direct Debit", currencies: ["eur"] },
  { capability: "ideal_payments", type: "ideal", label: "iDEAL", currencies: ["eur"] },
  { capability: "bancontact_payments", type: "bancontact", label: "Bancontact", currencies: ["eur"] },
  { capability: "p24_payments", type: "p24", label: "Przelewy24", currencies: ["eur", "pln"] },
  { capability: "blik_payments", type: "blik", label: "BLIK", currencies: ["pln"] },
  { capability: "bacs_debit_payments", type: "bacs_debit", label: "Bacs Direct Debit", currencies: ["gbp"] },
  { capability: "cashapp_payments", type: "cashapp", label: "Cash App Pay", currencies: ["usd"] },
  { capability: "us_bank_account_ach_payments", type: "us_bank_account", label: "US bank transfer", currencies: ["usd"] },
];

/**
 * The payment methods the *platform* has switched on, which is the third gate
 * and the one that is invisible from the account.
 *
 * A capability being active is necessary and not sufficient. Stripe also
 * consults a payment method configuration, which on a direct charge is the
 * child config the platform owns — so a method switched off in Sailo's own
 * Dashboard is offered to nobody, on any connected account, however verified.
 *
 * This is not hypothetical. `sepa_debit` is off in the platform's default
 * configuration today: `sepa_debit_payments` went active on every European
 * account, this file called the rail live, and no buyer was ever shown it. The
 * check script caught the claim, which is the only reason it is not shipping.
 *
 * Reading it means the Dashboard stays the place that decision is made.
 * Turning SEPA on there is enough — no table here has to be edited to match,
 * and nothing here can drift from it.
 *
 * Returns `null` when it cannot tell, which callers treat as "do not filter".
 * A configuration Stripe would not hand over is a bad reason to tell a seller
 * their card payments are off.
 */
export async function enabledMethods(
  stripe: Stripe,
  accountId: string,
): Promise<Set<string> | null> {
  let configs;
  try {
    configs = await stripe.paymentMethodConfigurations.list(
      {},
      { stripeAccount: accountId },
    );
  } catch {
    return null;
  }

  /*
   * A connected account can carry two, both flagged default: one of its own
   * and one inherited from the platform. Checkout uses the inherited one on a
   * direct charge — confirmed by expanding `payment_method_configuration_details`
   * on a session, which names the config with a `parent` — so that is the one
   * to read, and the account's own is the fallback.
   */
  const config =
    configs.data.find((c) => c.parent) ??
    configs.data.find((c) => c.is_default) ??
    configs.data[0];

  if (!config) return null;

  const enabled = new Set<string>();
  for (const [method, value] of Object.entries(config)) {
    const preference = (value as { display_preference?: { value?: string } })
      ?.display_preference;
    if (preference?.value === "on") enabled.add(method);
  }

  return enabled;
}

/**
 * The five states a rail can be in from the seller's chair.
 *
 * `off_currency` is the one that does not exist in Stripe's vocabulary and has
 * to be worked out here. It means the capability is live and the rail is
 * genuinely unusable anyway, because this shop prices in a currency the rail
 * does not settle in. Without it a seller reads "iDEAL — live" on the payments
 * screen and cannot understand why no Dutch buyer has ever used it.
 *
 * It is deliberately not folded into `unavailable`: the fix is a one-field
 * change the seller can make (price in EUR), which is a completely different
 * conversation from "Stripe will not give you this".
 */
export type SellerRailState = RailState | "off_currency";

export type SellerRail = {
  capability: string;
  type: string;
  label: string;
  state: SellerRailState;
  /** Named fields the seller must supply. Only ever populated on `blocked`. */
  currentlyDue: string[];
  /** What the shop would have to price in. Only populated on `off_currency`. */
  currencies: readonly string[];
};

/**
 * What this shop's buyers can actually pay with.
 *
 * `facts` is what `listCapabilities` last read off the account; `currency` is
 * the shop's own, which is what every Checkout Session is created in — see
 * `createCheckoutSession`, which takes it from the order row and switches
 * adaptive pricing off so Stripe cannot quietly present a different one.
 *
 * Rails Sailo never asked for are dropped rather than reported `unavailable`.
 * A US seller has no use for a line telling them Bancontact is off; the list
 * is for acting on, and an entry nobody can act on is noise. That is also why
 * the currency check runs only on a rail that is otherwise `live` — telling a
 * seller their unobtainable rail is also in the wrong currency helps nobody.
 */
export function sellerRails(opts: {
  currency: string | null | undefined;
  facts: Map<string, CapabilityFacts>;
  /**
   * What the platform has switched on, from `enabledMethods`. Omitted or
   * `null` means the question could not be asked, so nothing is filtered.
   */
  enabled?: Set<string> | null;
}): SellerRail[] {
  const currency = opts.currency?.toLowerCase() ?? "";

  return CONNECT_RAILS.flatMap((rail) => {
    const facts = opts.facts.get(rail.capability);
    // Never requested and never mentioned by Stripe: not this seller's rail.
    if (!facts || facts.status === "unrequested") return [];
    /*
     * Switched off for everyone by the platform. Dropped rather than reported,
     * for the same reason an unrequested rail is: the seller cannot act on it,
     * and a line on their screen they cannot act on is noise.
     */
    if (opts.enabled && !opts.enabled.has(rail.type)) return [];

    const report = classify(facts);

    const offCurrency =
      report.state === "live" &&
      rail.currencies.length > 0 &&
      !rail.currencies.includes(currency);

    return [
      {
        capability: rail.capability,
        type: rail.type,
        label: rail.label,
        state: offCurrency ? ("off_currency" as const) : report.state,
        currentlyDue: report.currentlyDue,
        currencies: offCurrency ? rail.currencies : [],
      },
    ];
  });
}
