import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS } from "@sailo/core/plans";

/**
 * No article may state Sailo's own price or fee as a literal.
 *
 * `blog-facts.ts` exists so an article writes `{{business_monthly}}` and gets
 * the current number, and it works: 317 of the 412 articles use a token. What
 * it could not do is stop an author writing a figure *derived* from the fee —
 * "on a $34 hoodie that's 17 cents" — and those are the ones that rotted. When
 * the fee ladder replaced a flat 0.5% and the plans went from $9.99/$19.99 to
 * ${{pro}}/${{business}}, every derived figure in the blog became wrong, in
 * public, with the correct token sitting in the same sentence. One article
 * ended up reading "Sailo Business, $49 + 1–3% on card | $30.79" — a price from
 * the new table and a total from the old one.
 *
 * A test cannot know that 17 cents was half a percent of $34. It can know that
 * a percentage or a plan price written next to the word "Sailo" is a literal
 * somebody typed, and that is the reliable signal: every legitimate statement
 * of our own rate goes through a token, so any that does not is either stale
 * already or one price change away from it.
 *
 * Scoped to "Sailo" on purpose. The corpus is full of competitors' prices —
 * Payhip at $29, Amazon at $39.99, Gumroad at 10% — and those are correct as
 * literals, carry their own verification date, and must not be interpolated
 * from our table. The rule is about claims we make about ourselves.
 */

const BLOG = join(import.meta.dirname, "..", "..", "content", "blog");

function articles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const locale of readdirSync(BLOG)) {
    const dir = join(BLOG, locale);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      out.push({
        path: `${locale}/${file}`,
        text: readFileSync(join(dir, file), "utf8"),
      });
    }
  }
  return out;
}

const ARTICLES = articles();

/**
 * A number followed by `%`, within a sentence of the word "Sailo".
 *
 * `[^}0-9]` before the digits is what lets a token through: a substituted fact
 * renders as `{{fee_range}}%`, so the character before the percentage is `}`
 * and never a digit. Bounded by `[^.]` so the match cannot run past a full stop
 * into an unrelated sentence about someone else's pricing.
 */
const LITERAL_PERCENT = /Sailo[^.]{0,60}[^}0-9]\d+(\.\d+)?%/g;

/** The plan prices, as an author would type them. Built from the table so a
 * price change moves the rule with it rather than leaving it guarding history. */
const PLAN_AMOUNTS = [
  PLANS.pro.monthlyCents,
  PLANS.pro.yearlyCents,
  PLANS.business.monthlyCents,
  PLANS.business.yearlyCents,
].map((cents) => cents / 100);

const LITERAL_PRICE = new RegExp(
  `Sailo[^.]{0,80}\\$(${PLAN_AMOUNTS.join("|")})\\b`,
  "g",
);

describe("what the blog says Sailo costs", () => {
  it("has articles to check", () => {
    // A path bug that finds nothing would make every assertion below vacuous.
    expect(ARTICLES.length).toBeGreaterThan(300);
  });

  it("never writes Sailo's fee as a literal percentage", () => {
    const offenders = ARTICLES.flatMap(({ path, text }) =>
      (text.match(LITERAL_PERCENT) ?? []).map((m) => `${path}: …${m.trim()}…`),
    );
    expect(
      offenders,
      "use {{fee_range}}, {{fee_free}}, {{fee_pro}} or {{fee_business}} instead",
    ).toEqual([]);
  });

  it("never writes a Sailo plan price as a literal", () => {
    const offenders = ARTICLES.flatMap(({ path, text }) =>
      (text.match(LITERAL_PRICE) ?? []).map((m) => `${path}: …${m.trim()}…`),
    );
    expect(
      offenders,
      "use {{pro_monthly}}, {{pro_yearly}}, {{business_monthly}} or {{business_yearly}}",
    ).toEqual([]);
  });

  it("does not still describe the flat half-percent fee it replaced", () => {
    /*
     * The specific ghost. "Not the half a percent" appeared in three articles
     * as a rhetorical aside — the sort of phrase no price-token scheme would
     * ever catch, because it names the old rate in words rather than digits.
     * Pinned by name so it cannot come back by copy-paste from an old draft.
     */
    const offenders = ARTICLES.filter(({ text }) =>
      /Sailo[^.]{0,80}half a percent|half a percent[^.]{0,80}Sailo/i.test(text),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
