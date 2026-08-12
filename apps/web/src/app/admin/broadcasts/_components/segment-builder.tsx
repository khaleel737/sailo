"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Users, X } from "lucide-react";
import {
  describeRule,
  ruleArg,
  CLIENT_SOURCES,
  MAX_RULES,
  PRODUCT_KINDS_SEGMENT,
  type RuleType,
} from "@/lib/broadcasts/segments";
import type { SegmentRule } from "@sailo/db/schema/json-types";
import type { SegmentPickers } from "@/lib/broadcasts/pickers";
import { countAudience } from "@/lib/actions/broadcasts";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";
import { Input, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Choosing who gets it.
 *
 * The v1 answer was a dropdown of tags, which can express "everyone" and
 * "everyone I remembered to label". Everything a seller actually wants to say
 * — the people who bought the thing I'm restocking, the ones who signed up
 * and never ordered, the ones who have not been back since spring — is a fact
 * the database already holds and the screen had no way to ask for.
 *
 * Two things make a builder like this usable rather than merely present, and
 * both are here: every condition reads as a sentence once it is on the list,
 * and the number of people it reaches updates as you build it. A rule whose
 * effect on that number is invisible is a rule a seller adds hopefully and
 * then sends blind.
 */

export type Segment = { match: "all" | "any"; rules: SegmentRule[] };

/** The menu, grouped the way a seller thinks about their list. */
const GROUPS: { key: "groupWho" | "groupBought" | "groupDid"; types: RuleType[] }[] = [
  { key: "groupWho", types: ["tag", "notTag", "source", "country"] },
  {
    key: "groupBought",
    types: ["product", "notProduct", "category", "kind", "coupon", "attended"],
  },
  {
    key: "groupDid",
    types: [
      "ordered",
      "neverOrdered",
      "minOrders",
      "minSpend",
      "orderedWithin",
      "lapsed",
      "abandoned",
      "joinedWithin",
      "subscribedWithin",
    ],
  },
];

/** Sensible starting numbers, so a condition is useful the moment it is added. */
const DEFAULT_N: Partial<Record<RuleType, number>> = {
  minOrders: 2,
  minSpend: 100,
  orderedWithin: 30,
  lapsed: 90,
  abandoned: 7,
  joinedWithin: 30,
  subscribedWithin: 30,
};

export function SegmentBuilder({
  segment,
  onChange,
  pickers,
  currency,
  disabled,
}: {
  segment: Segment;
  onChange: (next: Segment) => void;
  pickers: SegmentPickers;
  currency: string;
  disabled?: boolean;
}) {
  const a = useAdminT();
  const [type, setType] = useState<RuleType | "">("");
  const [value, setValue] = useState("");
  const [n, setN] = useState("");

  const money = (minor: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);

  const labels: Record<RuleType, string> = {
    tag: a.broadcasts.ruleTag,
    notTag: a.broadcasts.ruleNotTag,
    source: a.broadcasts.ruleSource,
    country: a.broadcasts.ruleCountry,
    product: a.broadcasts.ruleProduct,
    notProduct: a.broadcasts.ruleNotProduct,
    category: a.broadcasts.ruleCategory,
    kind: a.broadcasts.ruleKind,
    coupon: a.broadcasts.ruleCoupon,
    attended: a.broadcasts.ruleAttended,
    ordered: a.broadcasts.ruleOrdered,
    neverOrdered: a.broadcasts.ruleNeverOrdered,
    minOrders: a.broadcasts.ruleMinOrders,
    minSpend: a.broadcasts.ruleMinSpend,
    orderedWithin: a.broadcasts.ruleOrderedWithin,
    lapsed: a.broadcasts.ruleLapsed,
    abandoned: a.broadcasts.ruleAbandoned,
    joinedWithin: a.broadcasts.ruleJoinedWithin,
    subscribedWithin: a.broadcasts.ruleSubscribedWithin,
  };

  /* Spelled out rather than read by bracket, so the coverage check can see
     that every one of these keys reaches a screen. */
  const groupLabels = {
    groupWho: a.broadcasts.groupWho,
    groupBought: a.broadcasts.groupBought,
    groupDid: a.broadcasts.groupDid,
  };

  const sourceLabels: Record<string, string> = {
    order: a.broadcasts.sourceOrder,
    subscribe: a.broadcasts.sourceSubscribe,
    manual: a.broadcasts.sourceManual,
    import: a.broadcasts.sourceImport,
  };
  const kindLabels: Record<string, string> = {
    physical: a.broadcasts.kindPhysical,
    digital: a.broadcasts.kindDigital,
    service: a.broadcasts.kindService,
    event: a.broadcasts.kindEvent,
    membership: a.broadcasts.kindMembership,
  };

  /*
   * Every id and code a chip might need to name, in one map. The chips read
   * from it rather than from whichever picker the rule came from, so a rule
   * restored from a saved draft — whose type the builder never handled in
   * this session — still says what it means.
   */
  const names = new Map<string, string>();
  for (const option of [...pickers.products, ...pickers.categories, ...pickers.coupons, ...pickers.events]) {
    names.set(option.id, option.label);
  }
  for (const [key, label] of Object.entries(sourceLabels)) names.set(key, label);

  /* ---- the live count ---------------------------------------------------- */

  const [count, setCount] = useState<number | null>(null);
  const [pending, startCounting] = useTransition();
  const key = JSON.stringify(segment);

  useEffect(() => {
    let live = true;
    // Debounced, because a seller adding three conditions in a row would
    // otherwise fire three `count(*)`s over their whole customer list.
    const timer = setTimeout(() => {
      startCounting(async () => {
        const result = await countAudience(key);
        if (live) setCount(result.count);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);

  /* ---- editing ----------------------------------------------------------- */

  function addRule() {
    if (!type || segment.rules.length >= MAX_RULES) return;
    const arg = ruleArg(type);

    const rule: SegmentRule =
      arg === "none"
        ? { type }
        : arg === "days" || arg === "count"
          ? { type, n: Number(n) || DEFAULT_N[type] || 30 }
          : arg === "money"
            ? { type, n: Math.round((Number(n) || 0) * 100) }
            : { type, value: type === "country" ? value.toUpperCase() : value };

    // A rule that needs an argument and has none would parse to nothing on
    // the server and silently widen the audience — refuse it here instead.
    if (arg !== "none" && arg !== "days" && arg !== "count" && arg !== "money" && !value) return;
    if (arg === "money" && !Number(n)) return;

    onChange({ ...segment, rules: [...segment.rules, rule] });
    setType("");
    setValue("");
    setN("");
  }

  function removeRule(index: number) {
    onChange({ ...segment, rules: segment.rules.filter((_, i) => i !== index) });
  }

  const arg = type ? ruleArg(type) : null;
  const options =
    type === "product" || type === "notProduct"
      ? pickers.products
      : type === "attended"
        ? pickers.events
        : type === "category"
          ? pickers.categories
          : type === "coupon"
            ? pickers.coupons
            : type === "source"
              ? CLIENT_SOURCES.map((s) => ({ id: s, label: sourceLabels[s] ?? s }))
              : type === "kind"
                ? PRODUCT_KINDS_SEGMENT.map((k) => ({ id: k, label: kindLabels[k] ?? k }))
                : type === "tag" || type === "notTag"
                  ? pickers.tags.map((t) => ({ id: t, label: t }))
                  : [];

  return (
    <div className="space-y-3">
      {/* ---- what is already chosen ---- */}
      {segment.rules.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {segment.rules.map((rule, index) => (
            <span
              key={`${rule.type}-${rule.value ?? rule.n ?? index}`}
              className="inline-flex items-center gap-1 rounded-full bg-ink-100 py-1 ps-3 pe-1 text-xs font-medium text-ink-800"
            >
              {describeRule(rule, {
                labels,
                names,
                missing: a.broadcasts.deletedItem,
                money,
              })}
              {disabled ? null : (
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  aria-label={a.broadcasts.remove}
                  className="focus-ring flex size-5 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-200 hover:text-ink-900"
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}

          {/*
            All / any, and only once there are two conditions to join. With
            one rule the control is a choice between two identical audiences,
            which is a question that teaches a seller nothing.
          */}
          {segment.rules.length > 1 ? (
            <div className="inline-flex overflow-hidden rounded-full border border-ink-200">
              {(["all", "any"] as const).map((match) => (
                <button
                  key={match}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ ...segment, match })}
                  aria-pressed={segment.match === match}
                  className={cn(
                    "focus-ring px-2.5 py-1 text-[11px] font-medium transition",
                    segment.match === match
                      ? "bg-ink-900 text-white"
                      : "text-ink-500 hover:bg-ink-50",
                  )}
                >
                  {match === "all" ? a.broadcasts.matchAll : a.broadcasts.matchAny}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- adding one ---- */}
      {disabled || segment.rules.length >= MAX_RULES ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={type}
            onChange={(e) => {
              const next = e.target.value as RuleType | "";
              setType(next);
              setValue("");
              setN(next && DEFAULT_N[next] ? String(DEFAULT_N[next]) : "");
            }}
            aria-label={a.broadcasts.addCondition}
            className="h-10 w-full sm:w-56"
          >
            <option value="">{a.broadcasts.addCondition}</option>
            {GROUPS.map((group) => (
              <optgroup key={group.key} label={groupLabels[group.key]}>
                {group.types.map((ruleType) => (
                  <option key={ruleType} value={ruleType}>
                    {/* The label without its placeholders — "Bought {value}"
                        reads as "Bought…" before anything is chosen. */}
                    {labels[ruleType].replace(/\s*\{(value|n)\}\s*/g, "…")}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>

          {arg && options.length > 0 ? (
            <Select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={a.broadcasts.addCondition}
              className="h-10 w-full sm:w-56"
            >
              <option value="">
                {type === "product" || type === "notProduct" || type === "attended"
                  ? a.broadcasts.pickProduct
                  : type === "category"
                    ? a.broadcasts.pickCategory
                    : type === "coupon"
                      ? a.broadcasts.pickCoupon
                      : type === "source"
                        ? a.broadcasts.pickSource
                        : type === "kind"
                          ? a.broadcasts.pickKind
                          : a.broadcasts.pickTag}
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : null}

          {type === "country" ? (
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={2}
              placeholder="GB"
              aria-label={a.broadcasts.countryHint}
              className="h-10 w-20 uppercase"
            />
          ) : null}

          {arg === "days" || arg === "count" || arg === "money" ? (
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={1}
                value={n}
                onChange={(e) => setN(e.target.value)}
                className="h-10 w-24"
                aria-label={
                  arg === "days" ? a.broadcasts.days : arg === "count" ? a.broadcasts.orders : currency
                }
              />
              <span className="text-xs text-ink-500">
                {arg === "days" ? a.broadcasts.days : arg === "count" ? a.broadcasts.orders : currency}
              </span>
            </div>
          ) : null}

          {type ? (
            <button
              type="button"
              onClick={addRule}
              className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-xl border border-ink-200 px-3 text-sm font-medium text-ink-800 transition hover:bg-ink-50"
            >
              <Plus className="size-4" />
              {a.broadcasts.add}
            </button>
          ) : null}
        </div>
      )}

      {/* ---- how many that is ---- */}
      <p
        className="flex items-center gap-1.5 text-xs text-ink-500"
        aria-live="polite"
      >
        <Users className="size-3.5" />
        {pending || count === null
          ? a.broadcasts.counting
          : count === 0
            ? a.broadcasts.noMatches
            : interpolate(
                count === 1 ? a.broadcasts.matchesOne : a.broadcasts.matches,
                { count: count.toLocaleString() },
              )}
      </p>
    </div>
  );
}
