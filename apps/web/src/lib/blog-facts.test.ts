import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/plans";
import { applyFacts, blogFacts, FACT_KEYS } from "./blog-facts";

/**
 * Articles state prices as fact, in prose, in thirty-five languages. Three
 * hundred and twenty-two of them did it by typing the number, and every one
 * was wrong by the time the fee ladder shipped — most had been quoting a 0.5%
 * commission for months after the code stopped charging it.
 *
 * These pin the two halves of the fix: the tokens resolve to what `plans.ts`
 * actually says, and no article contains a token that will not resolve.
 */

const BLOG = path.join(process.cwd(), "content", "blog");

async function everyMarkdownFile(): Promise<string[]> {
  const out: string[] = [];
  for (const locale of await readdir(BLOG)) {
    const dir = path.join(BLOG, locale);
    for (const name of await readdir(dir)) {
      if (name.endsWith(".md")) out.push(path.join(dir, name));
    }
  }
  return out;
}

describe("blog facts", () => {
  it("resolves prices from the plan table, not from a copy of it", () => {
    const f = blogFacts();
    expect(f.pro_monthly).toBe(String(PLANS.pro.monthlyCents / 100));
    expect(f.business_monthly).toBe(String(PLANS.business.monthlyCents / 100));
    expect(f.free_products).toBe(String(PLANS.free.limits.products));
    expect(f.free_analytics_days).toBe(String(PLANS.free.limits.analyticsDays));
  });

  /*
   * Bare numerals, because the article supplies its own currency and percent
   * marks and the languages disagree about both. A `$` here produced
   * "$49 dolarjev" in Slovene — "$49 dollars".
   */
  it("emits bare numerals so each language keeps its own notation", () => {
    for (const [key, value] of Object.entries(blogFacts())) {
      expect(value, key).not.toMatch(/[$£€%]/);
    }
  });

  it("leaves an unknown token visible rather than blanking it", () => {
    // A typo must survive to review. "Business is a month" reads as prose and
    // would ship; "Business is {{buisness_monthly}} a month" does not.
    expect(applyFacts("Business is {{buisness_monthly}} a month")).toContain(
      "{{buisness_monthly}}",
    );
  });

  it("substitutes every known token", () => {
    const source = FACT_KEYS.map((k) => `{{${k}}}`).join(" ");
    expect(applyFacts(source)).not.toContain("{{");
  });

  it("has no article using a token that will not resolve", async () => {
    const known = new Set(FACT_KEYS);
    const unknown: string[] = [];

    for (const file of await everyMarkdownFile()) {
      const body = await readFile(file, "utf8");
      for (const match of body.matchAll(/\{\{([a-z0-9_]+)\}\}/g)) {
        const key = match[1];
        // `noUncheckedIndexedAccess` — group 1 is guaranteed by the pattern,
        // but the compiler cannot see that.
        if (key && !known.has(key)) {
          unknown.push(`${path.basename(file)}: {{${key}}}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });

  /*
   * The point of the exercise. An article may not carry a price of its own —
   * a number that looks right in review and is wrong at the checkout is
   * exactly what this replaced.
   */
  it("has no article quoting a plan price as a literal", async () => {
    const offenders: string[] = [];
    const stale = /(?<![\d.,])(19[.,]99|9[.,]99|95[.,]90|191[.,]90)(?![\d])/;

    for (const file of await everyMarkdownFile()) {
      const body = await readFile(file, "utf8");
      for (const line of body.split("\n")) {
        const hit = stale.exec(line);
        // A price in another currency is a seller's own, not ours: a £9.99
        // book is not the Pro plan.
        if (hit && !/[£€¥₹₩฿₦₱₽₺]\s*$/.test(line.slice(0, hit.index))) {
          offenders.push(`${path.basename(file)}: ${line.trim().slice(0, 70)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
