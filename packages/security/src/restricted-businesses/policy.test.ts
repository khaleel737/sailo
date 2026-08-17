import { describe, expect, it } from "vitest";
import {
  ACCEPTED_BUSINESSES,
  CONDITIONAL_BUSINESSES,
  DECLINED_BUSINESSES,
  JURISDICTION_RULES,
  declinedText,
  jurisdictionRulesFor,
  screenBusiness,
  screeningTermCount,
} from "./index";

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
      /*
       * Added when this list was reconciled line by line against Stripe's own
       * — see `STRIPE_LIST_RECONCILED`. Each was a category Stripe prohibits or
       * restricts and this policy did not mention at all, which is the gap that
       * matters: a seller reading a shorter list than their processor's is
       * being told yes by us and no by Stripe, after they have built a shop.
       */
      "timeshares",
      "commercial airlines",
      "cruise lines",
      "embassy",
      "identity theft protection",
      "telemarketing",
      "door-to-door",
      "dating",
      "cyberlockers",
      "funded proprietary trading",
      "shell banks",
      "bearer shares",
      "neobanks",
      "peer-to-peer money transfer",
      "signal jammers",
      "kava",
      "atms",
      "government economic support",
      "games console",
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
        /\byou\b|\baccepted\b|\bonly\b|\bwe review\b|\bwe may\b/i.test(b.condition),
        `the condition on "${b.name}" states no obligation`,
      ).toBe(true);
    }
  });
});

describe("the country rules", () => {
  it("keys every rule on a usable country code", () => {
    // The lookup is against `shops.stripeCountry`, which Stripe fixes at
    // account creation as an ISO alpha-2. A lowercase or three-letter key here
    // never matches anything and never errors — the rule simply stops existing.
    const codes = JURISDICTION_RULES.map((r) => r.country);
    expect(new Set(codes).size, "a country is listed twice").toBe(codes.length);
    for (const code of codes) {
      expect(code, `"${code}" is not an ISO alpha-2 code`).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("says something under every country, as list fragments", () => {
    for (const rule of JURISDICTION_RULES) {
      expect(rule.name.trim(), `${rule.country} has no name`).not.toBe("");
      expect(
        rule.declined.length + (rule.conditional?.length ?? 0),
        `${rule.country} adds no rules, so it should not be listed`,
      ).toBeGreaterThan(0);
      for (const item of [...rule.declined, ...(rule.conditional ?? [])]) {
        expect(item.trim(), `an empty item under ${rule.country}`).not.toBe("");
        expect(
          item.endsWith("."),
          `"${item}" ends in a full stop but renders as a list fragment`,
        ).toBe(false);
      }
    }
  });

  it("looks a country up whatever case it arrives in, and shrugs at none", () => {
    // `stripeCountry` is written from a form and from Stripe's own account
    // object, and only one of those is guaranteed uppercase.
    expect(jurisdictionRulesFor("th")?.country).toBe("TH");
    expect(jurisdictionRulesFor("TH")?.country).toBe("TH");
    // Null is "the global list is the whole policy here", not "unknown, refuse".
    expect(jurisdictionRulesFor(null)).toBeNull();
    expect(jurisdictionRulesFor("ZZ")).toBeNull();
  });
});

describe("screening a shop's own words", () => {
  it("knows a useful number of phrases", () => {
    // A bad merge that empties a table leaves a screen that clears everything
    // and reports nothing, which looks exactly like a platform with no problems.
    expect(screeningTermCount()).toBeGreaterThan(100);
  });

  it("clears an ordinary small business", () => {
    const verdict = screenBusiness({
      text: [
        "Poppy & Rye",
        "Small-batch sourdough and pastries, baked to order in Portland. Collection or local delivery.",
        "Seeded loaf",
        "Cinnamon bun box",
      ],
      country: "US",
    });
    expect(verdict.decision, JSON.stringify(verdict.matches)).toBe("clear");
  });

  it("clears an empty shop rather than guessing about it", () => {
    expect(screenBusiness({ text: [null, undefined, "   "] }).decision).toBe("clear");
  });

  it("refuses what has no innocent reading, and names the policy group", () => {
    const verdict = screenBusiness({ text: ["Ace Online Casino", "Sports betting tips"] });
    expect(verdict.decision).toBe("refuse");
    expect(verdict.matches.map((m) => m.group)).toContain("gambling");
  });

  it("only reviews a term that has one", () => {
    /*
     * The case this whole severity split exists for. "CBD" is cannabidiol in
     * Bristol and the central business district in Sydney, and a screen that
     * refused on it would close a florist for its address.
     */
    const verdict = screenBusiness({
      text: ["Sydney CBD Flowers", "Fresh bouquets delivered across the CBD"],
    });
    expect(verdict.decision).toBe("review");
    expect(verdict.matches.every((m) => m.severity === "review")).toBe(true);
  });

  it("finds a term the shop wrote in the plural", () => {
    /*
     * The tables are written in the singular because that is how anyone writes
     * a list, and shops are written in the plural because that is how anyone
     * sells things. Before the pattern handled it, a shop advertising "gift
     * cards" walked straight past a term reading "gift card" — a whole class of
     * miss that nothing would ever have reported.
     */
    const cards = screenBusiness({ text: ["We sell gift cards and wrapping"] });
    expect(cards.matches.map((m) => m.term)).toContain("gift card");

    // The -y words the plain plural cannot reach.
    const draws = screenBusiness({ text: ["Weekly lotteries and prize draws"] });
    expect(draws.matches.map((m) => m.term)).toContain("lottery");

    // And -es, so a term is not written twice to catch one shop.
    const boxes = screenBusiness({ text: ["Monthly mystery boxes"] });
    expect(boxes.matches.map((m) => m.term)).toContain("mystery box");
  });

  it("matches on word boundaries, not on substrings", () => {
    // "loan" inside "Sloane", "art" inside "cartography". A screen that fires
    // on either is a screen nobody will leave switched on.
    const verdict = screenBusiness({
      text: ["Sloane Street Cartography", "Hand-drawn maps and prints"],
    });
    expect(verdict.decision, JSON.stringify(verdict.matches)).toBe("clear");
  });

  it("adds the seller's own country to the reading", () => {
    /*
     * Vitamins are an ordinary shop almost everywhere and are on Stripe's Thai
     * prohibition list. The seller will not know that, which is exactly why the
     * country layer never refuses — it raises the shop for a person to answer.
     */
    const text = ["Bangkok Wellness", "Vitamins and minerals, delivered same day"];
    expect(screenBusiness({ text, country: "TH" }).decision).toBe("review");
    expect(
      screenBusiness({ text, country: "TH" }).matches.some(
        (m) => m.group === "jurisdiction" && m.country === "TH",
      ),
    ).toBe(true);
    // The same shop in Berlin is nobody's problem.
    expect(screenBusiness({ text, country: "DE" }).decision).toBe("clear");
  });
});
