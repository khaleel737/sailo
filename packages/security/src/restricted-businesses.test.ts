import { describe, expect, it } from "vitest";
import {
  ACCEPTED_BUSINESSES,
  CONDITIONAL_BUSINESSES,
  DECLINED_BUSINESSES,
  declinedText,
} from "./restricted-businesses";

/**
 * The three lists are a published policy, and they fail the way a policy fails
 * rather than the way code does: nothing throws, the page still renders, and
 * the first sign of trouble is a payment provider asking why a category they
 * require is missing. So the checks here are about the parts that go wrong
 * silently — a category dropped in an edit, an anchor that stops resolving, a
 * fragment written as a sentence and rendered mid-list.
 */

describe("the accepted and conditional lists", () => {
  it("names each business once", () => {
    const names = [
      ...ACCEPTED_BUSINESSES.map((b) => b.name),
      ...CONDITIONAL_BUSINESSES.map((b) => b.name),
    ];
    expect(new Set(names).size, "a business is listed twice").toBe(names.length);
  });

  it("says something concrete under every name", () => {
    for (const b of ACCEPTED_BUSINESSES) {
      expect(b.examples.trim(), `"${b.name}" has no examples`).not.toBe("");
    }
    for (const b of CONDITIONAL_BUSINESSES) {
      // A condition that fits in four words is a caveat, not a condition, and
      // a seller cannot tell from it whether they comply.
      expect(
        b.condition.trim().split(/\s+/).length,
        `the condition on "${b.name}" is too short to be actionable`,
      ).toBeGreaterThan(8);
    }
  });
});

describe("the declined list", () => {
  it("gives every group a unique anchor", () => {
    // Support replies link the exact group. A duplicate id means one of those
    // links quietly scrolls to the wrong category.
    const ids = DECLINED_BUSINESSES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `"${id}" is not usable as a URL fragment`).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it("gives every group a reason and at least three items", () => {
    for (const g of DECLINED_BUSINESSES) {
      expect(g.why.trim(), `"${g.group}" has no reasoning`).not.toBe("");
      expect(
        g.items.length,
        `"${g.group}" has too few items to be a category`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("writes items as fragments, because they render as a list", () => {
    for (const g of DECLINED_BUSINESSES) {
      for (const item of g.items) {
        expect(item.trim(), `an empty item under "${g.group}"`).not.toBe("");
        expect(
          item.endsWith("."),
          `"${item}" ends in a full stop but renders as a list fragment`,
        ).toBe(false);
      }
    }
  });

  it("lists nothing twice", () => {
    const items = DECLINED_BUSINESSES.flatMap((g) => g.items);
    const seen = new Set<string>();
    for (const item of items) {
      expect(seen.has(item), `"${item}" is declined twice`).toBe(false);
      seen.add(item);
    }
  });

  /*
   * The one that matters.
   *
   * These categories are not our preference — they are the conditions on which
   * Stripe, and the card networks behind it, keep acceptance open for every
   * seller on the platform. Trimming the list for readability is a reasonable
   * instinct and each of these is a plausible casualty of it, so each is named
   * here: the assertion is that the policy still covers what a processor
   * expects it to cover, whatever the prose around it looks like.
   */
  it("still covers every category a card processor requires", () => {
    const text = declinedText();
    const required = [
      "money transmission",
      "currency exchange",
      "lending",
      "debt collection",
      "securities",
      "cryptocurrency",
      "lotteries",
      "sports betting",
      "controlled drugs",
      "prescription medicines",
      "cannabis",
      "tobacco",
      "weapons",
      "ammunition",
      "explosives",
      "counterfeit",
      "pornography",
      "escorting",
      "pyramid",
      "get-rich-quick",
      "negative-option billing",
      "endangered species",
      "human organs",
      "stolen or hacked accounts",
      "terrorist",
      "transaction laundering",
    ];
    for (const term of required) {
      expect(text, `the declined list no longer mentions "${term}"`).toContain(term);
    }
  });

  it("declines sexual content involving minors, and says it is reported", () => {
    // The single item in this policy with a reporting obligation attached. It
    // is asserted on its own so that a rewrite of the adult group cannot lose
    // the reporting half of the sentence while keeping the prohibition.
    const adult = DECLINED_BUSINESSES.find((g) => g.id === "adult");
    expect(adult, "the adult group is gone").toBeDefined();
    const minors = adult?.items.filter((i) => i.includes("under 18")) ?? [];
    expect(minors.length, "no item about people under 18").toBeGreaterThan(0);
    expect(minors.join(" ")).toContain("report");
  });
});

describe("the boundary between the lists", () => {
  it("does not accept and decline the same trade", () => {
    /*
     * The overlaps that have to stay resolved. Each pair is a trade that
     * appears on both sides of the policy in a different form — sexual
     * wellness products are accepted while explicit content is not, tickets
     * are accepted while resale is not — and the risk is an edit that widens
     * the accepted side until it swallows the exception.
     */
    const accepted = ACCEPTED_BUSINESSES.map((b) => b.examples)
      .join(" ")
      .toLowerCase();
    for (const term of [
      "cannabis",
      "cbd",
      "vape",
      "nicotine",
      "weapon",
      "ammunition",
      "crypto",
      "casino",
      "escort",
      "pornograph",
    ]) {
      expect(
        accepted,
        `"${term}" is offered as an example of an accepted business`,
      ).not.toContain(term);
    }
  });

  it("keeps the conditional list conditional", () => {
    // Every entry here exists because something has to be true before the
    // trade is allowed. One phrased without an obligation has quietly become
    // an accepted business with a note attached.
    for (const b of CONDITIONAL_BUSINESSES) {
      expect(
        /\byou\b|\baccepted\b|\bonly\b/i.test(b.condition),
        `the condition on "${b.name}" states no obligation`,
      ).toBe(true);
    }
  });
});
