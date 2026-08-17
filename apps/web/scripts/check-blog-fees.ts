/**
 * Finds blog sentences that state a Sailo fee as a single amount.
 *
 * A scan, deliberately, and not a test. `blog-pricing-claims.test.ts` covers the
 * half that automates cleanly — a literal percentage or plan price is always
 * wrong, so that fails the build. This covers the half that does not: a figure
 * *derived* from the fee ("on a $34 hoodie that's 17 cents") is only wrong once
 * the rate moves, and no regular expression can tell a stale one from a correct
 * one. Run at the same moment as `check:prices`, which is to say whenever
 * `plans.ts` changes.
 *
 * It reports rather than fails, because roughly one hit in three is legitimate:
 * a sentence that names one plan ("Sailo Free takes $6.48") states a single
 * figure correctly. Made to fail the build it would need an allowlist of
 * individual sentences, which is a thing nobody maintains and everybody mutes.
 *
 * Why this class of bug is worth a tool at all: when the flat 0.5% became the
 * 1–3% ladder and the plans went to $19 and $49, twenty sentences across
 * nineteen articles kept the old arithmetic while the `{{token}}` in the same
 * sentence updated itself. One table read "Sailo Business, $49 + 1–3% on card |
 * $30.79" — a price from the new world and a total from the old one.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BLOG = join(import.meta.dirname, "..", "content", "blog");

/** A sentence that attributes something to Sailo's fee. */
const FEE = /Sailo(?:.{0,40})?(?:takes|fee|cut|commission|charges)/i;

/** A concrete amount: 17 cents, 14.5p, $30.79, £1.08, ₹12.50. */
const MONEY = /\d+(?:[.,]\d+)?\s?(?:cents?|pence)\b|\d+(?:\.\d+)?p\b|[$£₹€]\d/;

/**
 * Markers that make a single figure legitimate: an explicit range, or a named
 * plan the figure belongs to. `{{fee_` catches a sentence that already defers
 * to the fact table for its rate.
 */
const QUALIFIED = / to |–|between|Business|\bPro\b|\bFree\b|free plan|\{\{fee_/;

let flagged = 0;

for (const locale of readdirSync(BLOG)) {
  const dir = join(BLOG, locale);
  if (!statSync(dir).isDirectory()) continue;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;

    // Past the frontmatter: "author: Sailo team" is not a fee claim.
    const body = readFileSync(join(dir, file), "utf8").split(/^---$/m).slice(2).join("---");

    for (const sentence of body.split(/(?<=[.!?])\s+/)) {
      if (!FEE.test(sentence) || !MONEY.test(sentence)) continue;
      if (QUALIFIED.test(sentence)) continue;
      flagged++;
      console.log(`\n  ${locale}/${file}`);
      console.log(`     ${sentence.trim().replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
}

console.log(
  flagged === 0
    ? "\n  No unqualified Sailo fee amounts in the blog.\n"
    : `\n  ${flagged} sentence(s) to check by hand against plans.ts.\n`,
);
