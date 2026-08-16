import { PLANS, PLATFORM_FEE_RANGE_LABEL, type PlanId } from "@/lib/plans";

/**
 * The pricing facts an article is allowed to state, resolved at render time.
 *
 * Every post that mentions a price used to type it. Three hundred and
 * twenty-two of four hundred and twelve did, in thirty-five languages, and by
 * the time the fee ladder shipped every one of them was wrong — most had been
 * wrong for months already, quoting a 0.5% commission the code stopped
 * charging long before. Prose cannot be kept in step with a constant by
 * discipline; the only version that stays true is the one that is not written
 * down.
 *
 * So an article writes `{{business_monthly}}` and gets `$49`. The token is
 * substituted immediately before the markdown is parsed, which is the one
 * point every article passes through — see `blog.ts`. That also means the
 * surrounding sentence is untouched, which is what makes this safe in
 * languages nobody here can proofread: a numeral is a numeral in Malay and
 * Japanese too, and the grammar around it never moves.
 *
 * This deliberately does *not* cover claims about which plan a feature belongs
 * to. "Card payments need the Business plan" is a sentence, not a number, and
 * no amount of interpolation makes it true now that card settles on every
 * tier. Those have to be rewritten by hand.
 */

/**
 * The amount as a bare numeral — `49`, not `$49` and not `49.00`.
 *
 * No currency mark on purpose. Thirty-five languages do not agree on where it
 * goes or what it is: English writes `$49`, Slovene `49 dolarjev`, Arabic
 * `49 دولاراً`, Thai `49 ดอลลาร์`. A token that carried its own `$` would have
 * produced `$49 dolarjev` — "$49 dollars" — in every locale that names the
 * currency in words. Substituting the numeral alone leaves each language's
 * own notation exactly where its author put it.
 *
 * No decimals either, and that is not a rounding choice: every current plan
 * price is a whole number of dollars, which sidesteps the comma-versus-period
 * decimal split that would otherwise need a locale to resolve. Should a plan
 * ever be priced at $19.50, this has to learn about separators first.
 */
function money(cents: number): string {
  const whole = cents / 100;
  return Number.isInteger(whole) ? String(whole) : whole.toFixed(2);
}

function plan(id: PlanId) {
  return PLANS[id];
}

/**
 * The token table. Keys are what an author types between `{{` and `}}`.
 *
 * Built as a function rather than a frozen object so that a plan change is
 * picked up by a rebuild without anything here being touched.
 */
export function blogFacts(): Record<string, string> {
  const free = plan("free");
  const pro = plan("pro");
  const business = plan("business");

  return {
    // --- prices -----------------------------------------------------------
    pro_monthly: money(pro.monthlyCents),
    pro_yearly: money(pro.yearlyCents),
    business_monthly: money(business.monthlyCents),
    business_yearly: money(business.yearlyCents),

    /*
     * --- the fee ---------------------------------------------------------
     *
     * Bare again, for the same reason the prices are: the article already
     * carries its own percent mark, and the languages disagree about it as
     * much as they do about currency. English writes `0.5%`, Danish `0,5
     * procent`, Malay `0.5 peratus`, Turkish `yüzde 0,5` with the word in
     * front. Substituting the numeral alone leaves every one of them intact.
     *
     * `fee_range` is the honest default for an article, which addresses a
     * reader who has not picked a plan. `PLATFORM_FEE_RANGE_LABEL` is the
     * same ladder with its percent sign attached, for UI that has no
     * surrounding prose to supply one.
     */
    fee_range: PLATFORM_FEE_RANGE_LABEL.replace("%", ""),
    fee_free: String(free.feeBp / 100),
    fee_pro: String(pro.feeBp / 100),
    fee_business: String(business.feeBp / 100),

    // --- limits -----------------------------------------------------------
    free_products: String(free.limits.products),
    pro_products: String(pro.limits.products),
    free_analytics_days: String(free.limits.analyticsDays),
    pro_analytics_days: String(pro.limits.analyticsDays),
    business_analytics_days: String(business.limits.analyticsDays),
  };
}

/** Every token name, for the test that pins the set an author may use. */
export const FACT_KEYS = Object.keys(blogFacts()).sort();

const TOKEN = /\{\{([a-z0-9_]+)\}\}/g;

/**
 * Swap `{{token}}` for its current value.
 *
 * An unknown token is left exactly as written rather than blanked. A typo
 * should look like a typo in review, not silently delete the number the
 * sentence was built around — "Business is a month" reads as prose and would
 * ship; "Business is {{buisness_monthly}} a month" does not.
 */
export function applyFacts(markdown: string): string {
  const facts = blogFacts();
  return markdown.replace(TOKEN, (whole, key: string) => facts[key] ?? whole);
}
