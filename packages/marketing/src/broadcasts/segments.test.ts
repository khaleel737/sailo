import { describe, expect, it } from "vitest";
import {
  EVERYONE,
  MAX_RULES,
  describeRule,
  describeSegment,
  parseSegment,
  referencedIds,
  ruleArg,
  toFilter,
  type RuleType,
} from "./segments";

/**
 * What a segment is allowed to become.
 *
 * Every assertion here is about the same worry: a rule that does not parse
 * must *disappear*, and its disappearance must be visible in the count on the
 * compose screen — never quietly widen an audience into a shop's whole list,
 * and never silently narrow it to nobody. Both failures send the wrong email
 * to the wrong people, and neither would raise anything at send time.
 */

const UUID = "6f1c2f4c-0f1c-4b0e-9c1e-2f4c0f1c4b0e";

const LABELS: Record<RuleType, string> = {
  tag: "Tagged {value}",
  notTag: "Not tagged {value}",
  source: "Joined by {value}",
  country: "In {value}",
  product: "Bought {value}",
  notProduct: "Never bought {value}",
  category: "Bought from {value}",
  kind: "Bought a {value}",
  coupon: "Used code {value}",
  attended: "Turned up to {value}",
  ordered: "Has ordered",
  neverOrdered: "Never ordered",
  minOrders: "{n} orders or more",
  minSpend: "Spent {n} or more",
  orderedWithin: "Ordered in the last {n} days",
  lapsed: "No order in {n} days",
  abandoned: "Left an unpaid order in {n} days",
  joinedWithin: "Joined in the last {n} days",
  subscribedWithin: "Subscribed in the last {n} days",
};

const ctx = {
  labels: LABELS,
  names: new Map([[UUID, "Blue Hoodie"]]),
  missing: "a deleted item",
  money: (minor: number) => `£${(minor / 100).toFixed(2)}`,
};

describe("parsing a stored filter", () => {
  it("reads nothing at all as everyone", () => {
    expect(parseSegment(null)).toEqual(EVERYONE);
    expect(parseSegment(undefined)).toEqual(EVERYONE);
    expect(parseSegment("not an object")).toEqual(EVERYONE);
  });

  it("reads v1's single tag as the one-rule filter it always was", () => {
    // A broadcast sent before segments existed must keep reporting the
    // audience it actually went to — not "everyone", which it never was.
    expect(parseSegment(null, "vip")).toEqual({
      match: "all",
      rules: [{ type: "tag", value: "vip" }],
    });
  });

  it("prefers the filter over the legacy tag when both are present", () => {
    const parsed = parseSegment(
      { match: "all", rules: [{ type: "ordered" }] },
      "vip",
    );
    expect(parsed.rules).toEqual([{ type: "ordered" }]);
  });

  it("drops a rule whose argument is missing rather than keeping it argument-less", () => {
    // The dangerous shape: `{type: "product"}` with no id would match every
    // purchase ever made, turning a targeted send into a shop-wide one.
    const parsed = parseSegment({ match: "all", rules: [{ type: "product" }] });
    expect(parsed.rules).toEqual([]);
  });

  it("drops a rule type it has never heard of", () => {
    const parsed = parseSegment({
      match: "all",
      rules: [{ type: "hasPetDog", value: "yes" }, { type: "ordered" }],
    });
    expect(parsed.rules).toEqual([{ type: "ordered" }]);
  });

  it("refuses a product id that is not a uuid", () => {
    expect(
      parseSegment({ match: "all", rules: [{ type: "product", value: "1; drop table" }] })
        .rules,
    ).toEqual([]);
  });

  it("folds a tag the way the column stores it", () => {
    const parsed = parseSegment({
      match: "all",
      rules: [{ type: "tag", value: "  VIP Buyer " }],
    });
    expect(parsed.rules).toEqual([{ type: "tag", value: "vip-buyer" }]);
  });

  it("upper-cases a country and refuses one that is not two letters", () => {
    expect(
      parseSegment({ match: "all", rules: [{ type: "country", value: "gb" }] }).rules,
    ).toEqual([{ type: "country", value: "GB" }]);
    expect(
      parseSegment({ match: "all", rules: [{ type: "country", value: "United Kingdom" }] })
        .rules,
    ).toEqual([]);
  });

  it("bounds a day count on both ends", () => {
    const rules = (n: unknown) =>
      parseSegment({ match: "all", rules: [{ type: "lapsed", n }] }).rules;
    expect(rules(90)).toEqual([{ type: "lapsed", n: 90 }]);
    expect(rules(0)).toEqual([]);
    expect(rules(-5)).toEqual([]);
    expect(rules(999_999)).toEqual([]);
    expect(rules(Number.NaN)).toEqual([]);
    // A string from a form field is still a number when it says so.
    expect(rules("30")).toEqual([{ type: "lapsed", n: 30 }]);
  });

  it("keeps one copy of a repeated rule", () => {
    const parsed = parseSegment({
      match: "any",
      rules: [
        { type: "tag", value: "vip" },
        { type: "tag", value: "vip" },
        { type: "ordered" },
      ],
    });
    expect(parsed.rules).toHaveLength(2);
  });

  it("caps how many rules one audience may carry", () => {
    const parsed = parseSegment({
      match: "all",
      // Distinct, so dedupe is not what does the trimming.
      rules: Array.from({ length: MAX_RULES + 5 }, (_, i) => ({
        type: "lapsed",
        n: i + 1,
      })),
    });
    expect(parsed.rules).toHaveLength(MAX_RULES);
  });

  it("only accepts the two join modes", () => {
    expect(parseSegment({ match: "any", rules: [] }).match).toBe("any");
    expect(parseSegment({ match: "sometimes", rules: [] }).match).toBe("all");
  });
});

describe("what gets stored", () => {
  it("stores nothing for an empty segment", () => {
    // Null, not `{match:"all",rules:[]}` — "everyone" is the absence of a
    // filter, and a stored empty object on a historic row would claim to be
    // an audience decision nobody made.
    expect(toFilter(EVERYONE)).toBeNull();
  });

  it("stores the rules when there are any", () => {
    expect(toFilter({ match: "any", rules: [{ type: "ordered" }] })).toEqual({
      match: "any",
      rules: [{ type: "ordered" }],
    });
  });
});

describe("saying a segment back", () => {
  it("names an id from the lookup", () => {
    expect(describeRule({ type: "product", value: UUID }, ctx)).toBe("Bought Blue Hoodie");
  });

  it("says so when an id no longer resolves", () => {
    // Keeping the condition visible matters: dropping it from the summary
    // would describe an audience the send does not actually use.
    expect(describeRule({ type: "product", value: "gone" }, ctx)).toBe(
      "Bought a deleted item",
    );
  });

  it("formats money through the shop's currency, not the raw minor units", () => {
    expect(describeRule({ type: "minSpend", n: 5_000 }, ctx)).toBe("Spent £50.00 or more");
  });

  it("leaves a plain count alone", () => {
    expect(describeRule({ type: "minOrders", n: 3 }, ctx)).toBe("3 orders or more");
  });

  it("calls an empty segment everyone", () => {
    expect(
      describeSegment(EVERYONE, {
        ...ctx,
        everyone: "Everyone who opted in",
        join: { all: " · ", any: " / " },
      }),
    ).toBe("Everyone who opted in");
  });

  it("joins with the separator that matches the mode", () => {
    const segment = {
      match: "any" as const,
      rules: [{ type: "ordered" }, { type: "neverOrdered" }],
    };
    expect(
      describeSegment(segment, {
        ...ctx,
        everyone: "Everyone",
        join: { all: " · ", any: " / " },
      }),
    ).toBe("Has ordered / Never ordered");
  });
});

describe("the rule vocabulary", () => {
  it("agrees with itself about which rules need which control", () => {
    expect(ruleArg("ordered")).toBe("none");
    expect(ruleArg("product")).toBe("uuid");
    expect(ruleArg("minSpend")).toBe("money");
    expect(ruleArg("lapsed")).toBe("days");
  });

  it("reports the ids a segment mentions, so they can be resolved in one query", () => {
    const segment = parseSegment({
      match: "all",
      rules: [
        { type: "product", value: UUID },
        { type: "coupon", value: UUID },
        { type: "tag", value: "vip" },
      ],
    });
    const ids = referencedIds(segment);
    expect(ids.products).toEqual([UUID]);
    expect(ids.coupons).toEqual([UUID]);
    expect(ids.categories).toEqual([]);
  });
});
