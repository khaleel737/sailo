import type { SegmentFilter, SegmentRule } from "@/db/schema/json-types";
import { normalizeTag } from "@/lib/client-tags";
import { isUuid } from "@/lib/utils";

/**
 * Who a broadcast is for, as a question the database can answer.
 *
 * The v1 audience was one tag or everybody, which is the shape a seller
 * outgrows on their second campaign: the message that should go to people who
 * bought the thing being restocked, or to the ones who signed up and never
 * ordered, or to the seventy who have not bought since spring, has no way to
 * be addressed. Those are all the same kind of question — a property of a
 * person, or something they did — and this file is the one place that knows
 * how to ask any of them.
 *
 * Three rules the whole file is built around:
 *
 * **A rule is a question, not a list.** Nothing here materialises members. An
 * audience is re-asked at queue time, so a draft written on Tuesday and sent
 * on Friday includes Wednesday's buyer and excludes Thursday's unsubscribe.
 *
 * **Every rule is a correlated EXISTS in the same statement.** Not a filter in
 * TypeScript over rows that came back — that reads the whole client list to
 * answer a question about ten of them, and worse, it is a second place where
 * the consent check could be forgotten. The legal floor and the seller's
 * segment are one WHERE clause.
 *
 * **A cancelled order never counts as a purchase.** It is the same predicate
 * the customer list's lifetime-value column uses, and the two disagreeing
 * would mean a seller mailing "thanks for your order" to somebody whose order
 * they cancelled.
 */

/* --------------------------------------------------------------------------
   The vocabulary
-------------------------------------------------------------------------- */

export const SEGMENT_RULE_TYPES = [
  // Who they are
  "tag",
  "notTag",
  "source",
  "country",
  // What they bought
  "product",
  "notProduct",
  "category",
  "kind",
  "coupon",
  "attended",
  // What they have done
  "ordered",
  "neverOrdered",
  "minOrders",
  "minSpend",
  "orderedWithin",
  "lapsed",
  "abandoned",
  "joinedWithin",
  "subscribedWithin",
] as const;

export type RuleType = (typeof SEGMENT_RULE_TYPES)[number];

/**
 * What each rule carries beside its name.
 *
 * `arg` is the whole validation contract: a rule whose argument does not
 * parse is dropped rather than corrected, because a segment that quietly
 * loses a `product` id and mails the shop's entire list is the worst
 * available failure. Dropping narrows or widens visibly — the count on the
 * compose screen changes — and the seller sees it before pressing Send.
 */
const SPEC: Record<RuleType, { arg: "none" | "uuid" | "tag" | "code" | "days" | "count" | "money" }> = {
  tag: { arg: "tag" },
  notTag: { arg: "tag" },
  source: { arg: "code" },
  country: { arg: "code" },
  product: { arg: "uuid" },
  notProduct: { arg: "uuid" },
  category: { arg: "uuid" },
  kind: { arg: "code" },
  coupon: { arg: "uuid" },
  attended: { arg: "uuid" },
  ordered: { arg: "none" },
  neverOrdered: { arg: "none" },
  minOrders: { arg: "count" },
  minSpend: { arg: "money" },
  orderedWithin: { arg: "days" },
  lapsed: { arg: "days" },
  abandoned: { arg: "days" },
  joinedWithin: { arg: "days" },
  subscribedWithin: { arg: "days" },
};

/** Which rules need a picker, and which of the pickers they need. */
export function ruleArg(type: RuleType) {
  return SPEC[type].arg;
}

/** How a contact came to be on the list — `clients.source`. */
export const CLIENT_SOURCES = ["order", "subscribe", "manual", "import"] as const;

/** What a shop sells, for "bought any digital product". */
export const PRODUCT_KINDS_SEGMENT = [
  "physical",
  "digital",
  "service",
  "event",
  // Every membership payment writes an ordinary order with this kind, so
  // "email everyone who has ever been a member" needs no new rule.
  "membership",
] as const;

/**
 * A ceiling on how many rules one audience may carry.
 *
 * Not arbitrary: each rule is a correlated subquery, and the count runs on
 * every keystroke of the compose screen. Ten is past any real campaign and
 * well short of a segment that would time out the page it is being built on.
 */
export const MAX_RULES = 10;

/** Values a `days` argument may take. Bounded so the SQL cannot be handed a year in ms. */
const MAX_DAYS = 3_650;
const MAX_COUNT = 10_000;
const MAX_MONEY = 100_000_000;

/* --------------------------------------------------------------------------
   Parsing

   Everything arriving here is untrusted: a jsonb column written by an older
   deploy, a form field, a duplicated draft. There is no "mostly valid".
-------------------------------------------------------------------------- */

function isRuleType(value: unknown): value is RuleType {
  return typeof value === "string" && (SEGMENT_RULE_TYPES as readonly string[]).includes(value);
}

function parseNumber(raw: unknown, max: number): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.floor(n);
  if (rounded < 1 || rounded > max) return null;
  return rounded;
}

/**
 * A short symbolic value — a source, a country, a product kind.
 *
 * Folded to the shape the column stores and length-capped, so a rule can
 * never carry a paragraph into an index scan. It is not checked against the
 * enumerations above on purpose: a `source` this build has not heard of
 * matches nothing, which is the correct answer to a question about a value no
 * client carries, and is better than dropping the rule and mailing everyone.
 */
function parseCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, 32);
  return /^[a-zA-Z_-]+$/.test(value) ? value : null;
}

function parseCountry(raw: unknown): string | null {
  const code = parseCode(raw);
  return code && code.length === 2 ? code.toUpperCase() : null;
}

/** One rule, or null if it did not survive. */
function parseRule(raw: unknown): SegmentRule | null {
  if (!raw || typeof raw !== "object") return null;
  const { type, value, n } = raw as { type?: unknown; value?: unknown; n?: unknown };
  if (!isRuleType(type)) return null;

  switch (SPEC[type].arg) {
    case "none":
      return { type };
    case "uuid":
      return typeof value === "string" && isUuid(value) ? { type, value } : null;
    case "tag": {
      const tag = normalizeTag(value);
      return tag ? { type, value: tag } : null;
    }
    case "code": {
      const code = type === "country" ? parseCountry(value) : parseCode(value);
      return code ? { type, value: code } : null;
    }
    case "days": {
      const days = parseNumber(n, MAX_DAYS);
      return days ? { type, n: days } : null;
    }
    case "count": {
      const count = parseNumber(n, MAX_COUNT);
      return count ? { type, n: count } : null;
    }
    case "money": {
      const money = parseNumber(n, MAX_MONEY);
      return money ? { type, n: money } : null;
    }
  }
}

export type Segment = { match: "all" | "any"; rules: SegmentRule[] };

/** The audience every shop starts with: everyone who opted in. */
export const EVERYONE: Segment = { match: "all", rules: [] };

/**
 * The stored filter, read back safely — with v1's single tag as the fallback.
 *
 * Both arguments come from the same row and only one of them is ever set. A
 * broadcast sent before segments existed has a tag and no filter, and its
 * audience must keep meaning what it meant, so the tag becomes the one-rule
 * filter it always was rather than being read as "no rules" — which would
 * report a past send as having gone to everybody.
 */
export function parseSegment(
  filter: unknown,
  legacyTag?: string | null,
): Segment {
  if (!filter || typeof filter !== "object") {
    const tag = normalizeTag(legacyTag);
    return tag ? { match: "all", rules: [{ type: "tag", value: tag }] } : EVERYONE;
  }

  const { match, rules } = filter as { match?: unknown; rules?: unknown };
  const parsed = Array.isArray(rules)
    ? rules.map(parseRule).filter((r): r is SegmentRule => r !== null).slice(0, MAX_RULES)
    : [];

  return {
    match: match === "any" ? "any" : "all",
    rules: dedupe(parsed),
  };
}

/**
 * Two identical rules are one rule.
 *
 * The builder can produce a duplicate by pressing the same button twice, and
 * under `match: "all"` a repeat is a subquery run twice for an answer that
 * cannot differ. Under `any` it is worse than useless — it looks, in the
 * summary line, like a second condition that widened the audience.
 */
function dedupe(rules: SegmentRule[]): SegmentRule[] {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const key = `${rule.type}:${rule.value ?? ""}:${rule.n ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What goes into the jsonb column. Null when there is nothing to store. */
export function toFilter(segment: Segment): SegmentFilter | null {
  return segment.rules.length === 0
    ? null
    : { match: segment.match, rules: segment.rules };
}

/* --------------------------------------------------------------------------
   Saying it back
-------------------------------------------------------------------------- */

/** The words for each rule, `{value}` and `{n}` filled in by the caller. */
export type RuleLabels = Record<RuleType, string>;

/**
 * One rule in words, with ids resolved to the names a seller recognises.
 *
 * `names` is a lookup the caller builds — a product's title, a category's
 * name, a coupon's code. A rule whose id no longer resolves keeps its
 * position and says so, because silently dropping it from the summary would
 * describe an audience the send does not use.
 */
export type DescribeContext = {
  labels: RuleLabels;
  /** Product titles, category names and coupon codes, by id. */
  names: Map<string, string>;
  /** What an id that no longer resolves is called. */
  missing: string;
  /**
   * Minor units, in the shop's currency.
   *
   * A callback rather than a number formatted at the call site, because
   * "spent 5000 or more" is what the raw substitution produces and it is
   * wrong in every currency — including the ones where 5000 minor units is
   * fifty of something and the ones where it is five thousand.
   */
  money: (minor: number) => string;
};

export function describeRule(rule: SegmentRule, ctx: DescribeContext): string {
  const type = rule.type as RuleType;
  const template = ctx.labels[type] ?? type;
  const arg = SPEC[type]?.arg;

  const value = arg === "uuid" ? (ctx.names.get(rule.value ?? "") ?? ctx.missing) : (rule.value ?? "");
  const n = arg === "money" ? ctx.money(rule.n ?? 0) : String(rule.n ?? 0);

  return template.replace(/\{value\}/g, value).replace(/\{n\}/g, n);
}

/** The whole audience in one line, for a list row or a confirm button. */
export function describeSegment(
  segment: Segment,
  ctx: DescribeContext & { everyone: string; join: { all: string; any: string } },
): string {
  if (segment.rules.length === 0) return ctx.everyone;
  return segment.rules
    .map((rule) => describeRule(rule, ctx))
    .join(segment.match === "any" ? ctx.join.any : ctx.join.all);
}

/** Which ids a segment mentions, so a caller can resolve them in one query. */
export function referencedIds(segment: Segment): {
  products: string[];
  categories: string[];
  coupons: string[];
} {
  const out = { products: [] as string[], categories: [] as string[], coupons: [] as string[] };
  for (const rule of segment.rules) {
    if (!rule.value) continue;
    if (rule.type === "product" || rule.type === "notProduct" || rule.type === "attended") {
      out.products.push(rule.value);
    } else if (rule.type === "category") {
      out.categories.push(rule.value);
    } else if (rule.type === "coupon") {
      out.coupons.push(rule.value);
    }
  }
  return out;
}
