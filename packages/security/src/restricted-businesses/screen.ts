/**
 * The enforcement half: reading a shop's own words and saying which part of the
 * policy they land in.
 *
 * ── WHY A PUBLISHED POLICY IS NO LONGER ENOUGH ──────────────────────────────
 * Sailo opens Express connected accounts, and Stripe's Connect Platform
 * Agreement makes a platform "responsible and liable ... for all activity on
 * the connected accounts, whether initiated by them or not", while requiring it
 * to take "all reasonable steps" to keep those accounts off the restricted list.
 * The card networks arrived at the same place from the other side: Mastercard's
 * Merchant Monitoring Program standards effective 1 January 2026 and Visa's
 * acquirer monitoring programme both expect a merchant to be screened *before*
 * its first transaction and monitored afterwards. A policy page satisfies none
 * of that on its own — it is the thing we are screening against, not the screen.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * It is not a decision and it must not be built into one. Three honest limits,
 * all of which the caller has to hold:
 *
 *  1. **It reads English.** Sailo ships 35 storefront languages and a seller in
 *     Warsaw will write their shop in Polish. A term list in one language finds
 *     English shops and misses the rest, so a clear result means "nothing found
 *     in the words we can read", never "this shop is fine".
 *  2. **It reads words, not businesses.** "CBD" is cannabidiol in Bristol and
 *     the central business district in Sydney. Every term below with an innocent
 *     reading is graded `review`, and `refuse` is reserved for phrases that have
 *     none — which is why that set is small and stays small.
 *  3. **It is the outer layer, not the only one.** Stripe runs its own
 *     prohibited-business checks, KYC, sanctions and MATCH screening on every
 *     account we open. This exists to catch the obvious before a seller invests
 *     a fortnight in a catalogue we would have to close, and to give us the
 *     "reasonable steps" record the agreement asks for.
 *
 * The failure mode to design against is therefore a false positive, not a false
 * negative: a missed shop is caught downstream by Stripe, and a wrongly refused
 * one is a real small business told no by a regular expression.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { jurisdictionRulesFor } from "./jurisdictions";

/** What a match means for the shop. See the note above on why `refuse` is rare. */
export type ScreenSeverity = "refuse" | "review";

export type ScreenMatch = {
  /**
   * The anchor of the declined group this belongs to, so a refusal can link
   * `/restricted-businesses#crypto` rather than quoting the policy at someone.
   * `jurisdiction` for a country rule, which has no group of its own.
   */
  readonly group: string;
  /** The phrase that matched, for the log line and the support reply. */
  readonly term: string;
  readonly severity: ScreenSeverity;
  /** Set only for a country rule, naming which country's list it came from. */
  readonly country?: string;
};

export type ScreenVerdict = {
  /**
   * `refuse` when anything matched at that severity, `review` when something
   * milder did, `clear` when nothing did. Deliberately not a boolean: the
   * middle state is the common one and collapsing it loses the whole point.
   */
  readonly decision: "clear" | "review" | "refuse";
  readonly matches: readonly ScreenMatch[];
};

export type ScreenInput = {
  /**
   * Everything the shop says about itself — name, description, product titles,
   * category names. Passed as fragments rather than one string so the caller
   * does not have to join them, and so an empty field costs nothing.
   */
  readonly text: readonly (string | null | undefined)[];
  /**
   * The seller's business country, i.e. `shops.stripeCountry`. Null before an
   * account exists, which only means the country layer does not apply yet.
   */
  readonly country?: string | null;
};

/**
 * Phrases with no innocent reading, in the language this file can read.
 *
 * The bar for adding one is that you cannot construct an ordinary small
 * business that would write it about itself. "Money transfer" clears that bar;
 * "gift card" does not, because half the bakeries on the platform sell one.
 * Everything that fails the bar goes in the review table instead, where being
 * wrong costs a log line rather than a livelihood.
 */
const REFUSE: Readonly<Record<string, readonly string[]>> = {
  adult: [
    "escort service",
    "escort agency",
    "sexual services",
    "cam girl",
    "camgirl",
    "onlyfans content",
    "explicit content",
    "porn",
    "pornography",
    "pornographic",
  ],
  gambling: [
    "online casino",
    "sports betting",
    "betting tips",
    "betting odds",
    "penny auction",
    "bidding fee auction",
  ],
  crypto: [
    "crypto exchange",
    "cryptocurrency exchange",
    "initial coin offering",
    "mining contract",
    "hash rate",
    "buy bitcoin",
    "sell bitcoin",
  ],
  financial: [
    "money transfer service",
    "money transmission",
    "cheque cashing",
    "check cashing",
    "payday loan",
    "debt collection agency",
    "credit repair",
    "bail bond",
    "prop firm",
    "funded trading account",
  ],
  "regulated-goods": [
    "cannabis dispensary",
    "cbd oil",
    "e-liquid",
    "vape juice",
    "nicotine pouch",
    "prescription medication",
    "prescription medicine",
    "ammunition",
    "firearm",
    "firearms",
    "silencer suppressor",
  ],
  counterfeit: [
    "replica watches",
    "replica bags",
    "aaa replica",
    "cracked software",
    "licence keys",
    "license keys",
  ],
  data: [
    "buy followers",
    "buy likes",
    "buy views",
    "hacked accounts",
    "verified accounts for sale",
    "ddos",
    "stresser",
  ],
  deceptive: [
    "multi level marketing",
    "multi-level marketing",
    "pyramid scheme",
    "get rich quick",
    "guaranteed returns",
    "guaranteed income",
    "fake diploma",
    "novelty id",
    "fake id",
  ],
  travel: ["timeshare", "timeshare exit"],
  unapproved: ["dating service", "matchmaking service", "mail order bride"],
};

/**
 * Phrases that are usually one of these trades and sometimes are not.
 *
 * Every entry here is a term a legitimate shop can plausibly write. "Raffle" is
 * a lottery and also what a village fete calls its tombola; "CBD" is a
 * cannabinoid and also downtown Sydney; "escort" is a trade and also a Ford. So
 * they are surfaced for a person to look at, and nothing is refused on them.
 */
const REVIEW: Readonly<Record<string, readonly string[]>> = {
  adult: ["adult content", "nsfw", "fetish", "lingerie modelling", "escort"],
  gambling: [
    "raffle",
    "prize draw",
    "sweepstake",
    "lottery",
    "mystery box",
    "loot box",
    "giveaway entry",
  ],
  crypto: ["crypto", "cryptocurrency", "bitcoin", "ethereum", "nft", "token sale", "web3"],
  financial: [
    "investment",
    "brokerage",
    "forex",
    "trading signals",
    "insurance",
    "extended warranty",
    "escrow",
    "gift card",
    "remittance",
    "currency exchange",
    "crowdfunding",
    "loan",
  ],
  "regulated-goods": [
    "cbd",
    "hemp",
    "kratom",
    "kava",
    "vape",
    "e-cigarette",
    "tobacco",
    "cigars",
    "nitrous oxide",
    "pepper spray",
    "stun gun",
    "fireworks",
    "pesticide",
    "supplement",
    "weight loss",
    "telemedicine",
    "pharmacy",
  ],
  counterfeit: ["replica", "dupe", "inspired by", "unbranded designer", "reseller keys"],
  travel: ["charter flight", "cruise", "airline tickets", "travel club", "holiday club"],
  living: ["puppies", "kittens", "livestock", "ivory", "taxidermy"],
  deceptive: [
    "passive income",
    "financial freedom",
    "make money online",
    "essay writing",
    "coursework",
  ],
  unapproved: ["file hosting", "cyberlocker", "file sharing"],
  government: ["visa application", "passport service", "government grant"],
};

type CompiledTerm = { group: string; term: string; pattern: RegExp; severity: ScreenSeverity };

function escapeTerm(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One term, as the pattern that finds it in a sentence somebody actually wrote.
 *
 * Three rules, each of which exists because the naive version missed something
 * real when this was measured against sixteen ordinary shop blurbs:
 *
 *  1. **Word boundaries at both ends.** Otherwise "loan" fires on "Sloane
 *     Street" and "art" on "cartography", and a screen that does that is a
 *     screen somebody switches off within a week.
 *  2. **Spaces and hyphens are interchangeable inside a term**, so
 *     "multi-level marketing" also finds "multi level marketing". The two
 *     spellings are both listed above anyway — a reader of those tables should
 *     not have to know this rule to trust them.
 *  3. **The last word may be plural.** This is the one that was actually
 *     costing matches: a shop selling "gift cards" sailed past a term written
 *     "gift card", because the `\b` after "card" cannot fall before an "s".
 *     Every table entry is written in the singular, which is how anyone would
 *     write them, so the plural has to be the pattern's problem rather than the
 *     author's. `(?:e?s)?` covers cards/boxes/services; the `y → ies` swap
 *     covers lottery and cryptocurrency, which the first rule cannot reach.
 *
 * `escapeTerm` matters more than it looks: several terms carry a hyphen, and an
 * unescaped one inside a character class changes what the pattern means rather
 * than failing loudly.
 */
function termPattern(term: string): RegExp {
  const escaped = escapeTerm(term.trim()).replace(/[\s-]+/g, "[\\s-]+");
  const pluralised = escaped.endsWith("y")
    ? `${escaped.slice(0, -1)}(?:y|ies)`
    : `${escaped}(?:e?s)?`;
  return new RegExp(`\\b${pluralised}\\b`, "i");
}

function compile(
  table: Readonly<Record<string, readonly string[]>>,
  severity: ScreenSeverity,
): CompiledTerm[] {
  return Object.entries(table).flatMap(([group, terms]) =>
    terms.map((term) => ({ group, term, severity, pattern: termPattern(term) })),
  );
}

const TERMS: readonly CompiledTerm[] = [
  ...compile(REFUSE, "refuse"),
  ...compile(REVIEW, "review"),
];

/** How many phrases the screen knows. Asserted in the tests, so a table that
 * gets emptied by a bad merge fails there rather than in production silence. */
export function screeningTermCount(): number {
  return TERMS.length;
}

/**
 * Reads a shop's own words against the policy.
 *
 * Order matters in one place only: a `refuse` match anywhere outranks every
 * `review` match, because the decision is about the worst thing found and not
 * about how much was found. Everything else is reported so a person can read
 * the whole picture rather than the first hit.
 */
export function screenBusiness(input: ScreenInput): ScreenVerdict {
  const haystack = input.text
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(" \n ")
    .toLowerCase();

  if (!haystack.trim()) return { decision: "clear", matches: [] };

  const matches: ScreenMatch[] = [];

  for (const { group, term, pattern, severity } of TERMS) {
    if (pattern.test(haystack)) matches.push({ group, term, severity });
  }

  /*
   * The country layer, matched the same way and reported separately.
   *
   * Never `refuse`, however plainly it matches. These are trades that are
   * ordinary somewhere and prohibited where this seller banked — vitamins in
   * Thailand, vehicle sales in India — so the shop is not misconduct and the
   * seller is very unlikely to know. A person tells them; a regex does not.
   */
  const rules = jurisdictionRulesFor(input.country);
  if (rules) {
    for (const trade of rules.declined) {
      // The head of the phrase only: the entries there are written as prose
      // ("cash couriers and currency transportation") and matching the whole
      // clause would need a shop to have copied it out.
      const head = trade.split(",")[0]?.trim();
      if (!head || head.length < 4) continue;
      if (termPattern(head).test(haystack)) {
        matches.push({
          group: "jurisdiction",
          term: head,
          severity: "review",
          country: rules.country,
        });
      }
    }
  }

  const decision = matches.some((m) => m.severity === "refuse")
    ? "refuse"
    : matches.length > 0
      ? "review"
      : "clear";

  return { decision, matches };
}
