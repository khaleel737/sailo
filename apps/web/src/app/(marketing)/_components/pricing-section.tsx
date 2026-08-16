import { Check } from "lucide-react";
import { interpolate } from "@sailo/i18n";
import type { MarketingDictionary } from "@sailo/i18n/marketing";
import type { Dictionary } from "@sailo/i18n";
import { PLANS, PLATFORM_FEE_RANGE_LABEL, type Plan } from "@/lib/plans";
import { formatMoney } from "@/lib/utils";
import { Cta, Section, SectionHead } from "@/components/marketing/kit";

/** The pricing table: three plans, one of them featured. */

/*
 * A featured card is the same card on a dark surface, so every piece of it
 * needs the inverted ink. Resolving that once per card — rather than asking
 * `featured ?` at each of a dozen elements — is what keeps the two columns
 * from drifting apart when one of them is edited.
 */
type Ink = {
  card: string;
  heading: string;
  body: string;
  price: string;
  unit: string;
  note: string;
  feature: string;
  cta: "invert" | "outline";
};

const PLAIN: Ink = {
  card: "bg-[var(--paper)]",
  heading: "text-[var(--ink)]",
  body: "text-[var(--mute-500)]",
  price: "text-[var(--ink)]",
  unit: "text-[var(--mute-400)]",
  note: "text-[var(--mute-400)]",
  feature: "text-[var(--mute-600)]",
  cta: "outline",
};

const FEATURED: Ink = {
  card: "bg-[var(--ink)] text-[var(--paper)]",
  heading: "text-[var(--paper)]",
  body: "text-[var(--on-ink-mute)]",
  price: "text-[var(--paper)]",
  unit: "text-[var(--on-ink-mute)]",
  note: "text-[var(--on-ink-mute)]",
  feature: "text-[var(--on-ink-soft)]",
  cta: "invert",
};

type Tier = { plan: Plan; tagline: string; carry: string | null };

function PlanCard({
  tier,
  t,
  m,
  locale,
}: {
  tier: Tier;
  t: Dictionary;
  m: MarketingDictionary;
  locale: string;
}) {
  const { plan, tagline, carry } = tier;
  const featured = plan.id === "business";
  const ink = featured ? FEATURED : PLAIN;

  return (
    <div className={`reveal flex flex-col p-8 lg:p-10 ${ink.card}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={`text-[1.0625rem] font-medium ${ink.heading}`}>
          {plan.name}
        </h3>
        {featured ? (
          <span className="rounded-[var(--r-pill)] border border-white/20 px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--on-ink-soft)]">
            {t.billing.bestValue}
          </span>
        ) : null}
      </div>

      <p className={`mt-3 min-h-12 text-[0.9375rem] leading-relaxed ${ink.body}`}>
        {tagline}
      </p>

      <p className="mt-9 flex items-baseline gap-2">
        <span className={`display tabular text-[3rem] ${ink.price}`}>
          {plan.monthlyCents === 0
            ? t.common.free
            : formatMoney(plan.monthlyCents, "USD", locale)}
        </span>
        {plan.monthlyCents > 0 ? (
          <span className={`text-[0.875rem] ${ink.unit}`}>
            {t.billing.perMonth}
          </span>
        ) : null}
      </p>

      {/* Reserves its line whether or not there is a yearly price, so the three
          cards' buttons stay on one row. */}
      <p className={`tabular mt-2 min-h-5 text-[0.8125rem] ${ink.note}`}>
        {plan.yearlyCents > 0
          ? interpolate(t.billing.billedYearly, {
              amount: formatMoney(plan.yearlyCents, "USD", locale),
            })
          : ""}
      </p>

      <Cta href="/signup" tone={ink.cta} size="md" className="mt-9 w-full">
        {plan.id === "free"
          ? m.pricing.start
          : interpolate(m.pricing.choose, { plan: plan.name })}
      </Cta>

      {carry ? (
        <p
          className={`mt-9 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] ${ink.note}`}
        >
          {carry}
        </p>
      ) : null}

      <ul className={carry ? "mt-5 space-y-3.5" : "mt-9 space-y-3.5"}>
        {plan.highlights.map((key) => (
          <li
            key={key}
            className={`flex gap-3 text-[0.875rem] leading-snug ${ink.feature}`}
          >
            <Check className="mt-px size-4 shrink-0 opacity-45" strokeWidth={2.5} />
            {t.highlights[key]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PricingSection({
  t,
  m,
  locale,
}: {
  t: Dictionary;
  m: MarketingDictionary;
  locale: string;
}) {
  const tiers: Tier[] = [
    { plan: PLANS.free, tagline: m.pricing.freeTagline, carry: null },
    { plan: PLANS.pro, tagline: m.pricing.proTagline, carry: m.pricing.everythingFree },
    { plan: PLANS.business, tagline: m.pricing.bizTagline, carry: m.pricing.everythingPro },
  ];

  return (
    <Section id="pricing">
      <SectionHead
        eyebrow={m.pricing.eyebrow}
        title={m.pricing.title}
        /* `pricing.body` names the card fee, so it carries {fee} like every
           other sentence that does. Passing it straight through printed the
           placeholder itself on the live page. */
        body={interpolate(m.pricing.body, { fee: PLATFORM_FEE_RANGE_LABEL })}
      />

      {/* A 1px gap filled by the surface behind draws the dividers, so the
          three cards read as one table rather than three floating boxes. */}
      <div className="mt-16 grid gap-px overflow-hidden rounded-[var(--r-card)] bg-[var(--mute-200)] lg:grid-cols-3">
        {tiers.map((tier) => (
          <PlanCard key={tier.plan.id} tier={tier} t={t} m={m} locale={locale} />
        ))}
      </div>

      <p className="mt-10 text-center text-[0.8125rem] text-[var(--mute-400)]">
        {interpolate(t.billing.cancelAnyTime, { fee: PLATFORM_FEE_RANGE_LABEL })}
      </p>
    </Section>
  );
}
