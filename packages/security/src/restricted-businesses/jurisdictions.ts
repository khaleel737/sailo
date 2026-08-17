/**
 * The same question, where the answer changes by country.
 *
 * Everything in `./declined` holds everywhere. This file holds what is declined
 * *in addition*, for a seller whose business is in a particular country — and
 * it exists because that layer was missing entirely, which for a product that
 * opens connected accounts in dozens of countries is not a rounding error.
 *
 * ── WHICH COUNTRY, AND WHY IT IS THAT ONE ───────────────────────────────────
 * The seller's, not the buyer's. Stripe decides eligibility on the connected
 * account's business location, which is fixed at account creation and cannot be
 * edited afterwards — `requireStripeCountry` in `@sailo/payments` refuses to
 * guess it for exactly that reason. So the key here is `shop.stripeCountry`,
 * and a German seller with Japanese customers is bound by the German list.
 *
 * A shop with no connected account has no country to look up, and that is not a
 * hole: these are Stripe's own country prohibitions, they bite when a card
 * payment is attempted, and a shop taking cash on delivery in Bangkok is bound
 * by Thai law rather than by Stripe's Thai list. `jurisdictionRulesFor` returns
 * null and the caller falls back to the everywhere list, which is correct.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ── WHY IT IS NOT SIMPLY MERGED INTO THE DECLINED LIST ───────────────────────
 * Because the merged version is unreadable and gets trimmed. Fifteen countries
 * of prohibitions folded into thirteen global groups is a page nobody finishes,
 * and the first editor to "tidy" it deletes the country a seller is actually in.
 * Kept apart, the global list stays the thing a seller reads and this stays the
 * thing a seller in Thailand is shown as well.
 *
 * Stated as trades rather than as codes on purpose: this text is rendered on
 * the public policy page under the country's own heading, so a reader has to be
 * able to recognise their own business in it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Not exhaustive as a statement of local law, and not meant to be — it is a
 * transcription of the country sections of Stripe's published list as at
 * `STRIPE_LIST_RECONCILED`. Local law may forbid more, and the
 * seller-obligations clause of the terms puts that on the seller.
 */

/** What the country list does to a trade the global list would have allowed. */
export type JurisdictionStance = "declined" | "conditional";

export type JurisdictionRule = {
  /** ISO 3166-1 alpha-2, matching `shops.stripeCountry`. */
  readonly country: string;
  /** The country's name, for the heading on the public page. */
  readonly name: string;
  /** Declined for a seller here, on top of everything declined everywhere. */
  readonly declined: readonly string[];
  /**
   * Allowed here, but only after we have reviewed the shop — Stripe's own
   * "restricted" rather than "prohibited" for this country. Optional because
   * most countries add prohibitions and nothing else.
   */
  readonly conditional?: readonly string[];
};

export const JURISDICTION_RULES: readonly JurisdictionRule[] = [
  {
    country: "BR",
    name: "Brazil",
    declined: [
      "genital and nipple jewellery",
      "genital prosthetics",
      "sex accessories and lifelike sex toys",
    ],
  },
  {
    country: "CA",
    name: "Canada",
    declined: ["mortgage consulting"],
    conditional: ["alcohol, which is reviewed before card payments are enabled"],
  },
  {
    country: "IN",
    name: "India",
    declined: [
      "alcohol",
      "airbags",
      "captive insurance companies",
      "cash couriers and currency transportation",
      "charities, non-profits and religious organisations",
      "chit funds",
      "currency exchange",
      "dating and matchmaking services",
      "gambling equipment",
      "genital prosthetics",
      "jewellery sold across a border",
      "high-value goods, precious metals and stones",
      "junket operators",
      "lobby groups and political organisations",
      "mining, and oil drilling or refining",
      "personal investment vehicles and trust service providers",
      "sex accessories and sex toys",
      "unlicensed financial institutions",
      "vehicle sales",
    ],
  },
  {
    country: "ID",
    name: "Indonesia",
    declined: ["domestic charter air travel"],
    conditional: [
      "alcohol",
      "insurance",
      "live chat and live streaming",
      "livestock",
      "packaged food and cosmetics",
      "pilgrimage and Umrah tour packages",
      "precious metals and jewellery",
      "products that need a national-standard certification",
    ],
  },
  {
    country: "JP",
    name: "Japan",
    declined: [
      "advisory services for drop-shipping and resale",
      "animals",
      "consumer-to-consumer services outside Stripe Connect",
      "consultation on online gaming, gambling, trading or investments",
      "donations to individuals",
      "fundraising for a business this policy declines",
      "genital and nipple jewellery",
      "genital prosthetics",
      "health instruments",
      "industrial waste and water-purifier devices",
      "international marriage brokerage",
      "mortgage consulting",
      "private investigators and personal protection services",
      "psychic services and fortune telling",
      "sex accessories and lifelike sex toys",
      "any shop without the commercial disclosure page the Specified Commercial Transactions Act requires",
    ],
  },
  {
    country: "MY",
    name: "Malaysia",
    declined: [
      "domestic charter air travel",
      "genital and nipple jewellery",
      "genital prosthetics",
      "matchmaking",
      "sex accessories and sex toys",
    ],
  },
  {
    country: "MX",
    name: "Mexico",
    declined: [
      "adoption agencies",
      "currency exchange across a border",
      "debt collection agencies",
      "direct-marketing travel",
      "domestic charter air travel",
      "electronic cigarettes sold without the card present",
      "ephedrine",
      "games console modification devices",
      "genital and nipple jewellery",
      "genital prosthetics",
      "HCG weight-loss products",
      "investment services",
      "lifelike sex toys",
      "penny auctions",
      "private investigators and personal protection services",
      "psychic services and fortune telling",
      "search engine optimisation services",
      "telemedicine",
    ],
  },
  {
    country: "SG",
    name: "Singapore",
    declined: [
      "domestic charter air travel",
      "genital and nipple jewellery",
      "advertising for anything unlawful in Singapore",
      "sex accessories and sex toys",
    ],
  },
  {
    country: "TH",
    name: "Thailand",
    declined: [
      "alcohol",
      "bodyguard services",
      "charities",
      "dating services",
      "historical artefacts",
      "new and used vehicle sales",
      "private investigators and detective agencies",
      "psychic services and fortune telling",
      "timeshares",
      "vitamins",
    ],
    conditional: [
      "domestic charter air travel",
      "food and cosmetics",
      "hotels, tour operators and transport",
      "insurance",
    ],
  },
  {
    country: "AE",
    name: "United Arab Emirates",
    declined: [
      "domestic charter air travel",
      "gambling equipment",
      "genital prosthetics",
      "historical artefacts, ivory and prison-made products",
      "matchmaking services",
      "private investigators",
      "sex accessories and sex toys",
    ],
  },
  {
    country: "US",
    name: "United States",
    declined: [
      "extended warranties",
      "medical benefit packages that are neither government nor insurance",
      "mortgage consulting",
      "shipping brokerage and freight forwarding without the authorisation it requires",
    ],
  },
] as const;

/** Index built once. The lookup runs on the connect path, per seller. */
const BY_COUNTRY = new Map(JURISDICTION_RULES.map((r) => [r.country, r]));

/**
 * The extra rules for a seller in this country, or null where there are none.
 *
 * Null is the answer for most of the world and is not a failure: it means the
 * global list is the whole of the policy there. Callers must not treat it as
 * "unknown country, refuse" — a shop with no Stripe account yet passes null in,
 * and refusing it would stop the seller before they could open one.
 */
export function jurisdictionRulesFor(
  country: string | null | undefined,
): JurisdictionRule | null {
  if (!country) return null;
  return BY_COUNTRY.get(country.toUpperCase()) ?? null;
}
