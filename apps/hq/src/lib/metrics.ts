/**
 * The arithmetic behind /hq — what a subscription is worth per month, how a
 * shop's billing actually stands, and how to add up money that isn't all in
 * the same currency.
 *
 * Pure. No database, no `next/*`, nothing that needs a request. The reads live
 * in `lib/hq.ts`; this is the part that decides what the numbers mean, and it
 * is the part worth testing directly.
 */
import { isPlanId, PLANS, type PlanId } from "@sailo/core/plans";
import { formatMoney } from "@sailo/core/currency";

/** The billing columns every calculation here needs. */
export type BillingRow = {
  plan: string;
  subscriptionStatus: string | null;
  subscriptionInterval: string | null;
  compPlan: string | null;
};

/**
 * Where an account stands with us, in the order that matters when more than
 * one could apply.
 *
 *   comped    we granted the plan; no money changes hands
 *   paying    Stripe says active — this is what MRR is made of
 *   trialing  entitled, hasn't paid yet
 *   past_due  a renewal failed; Stripe is retrying, revenue is at risk
 *   canceled  was paying, isn't now
 *   free      never paid
 */
export type BillingState =
  | "comped"
  | "paying"
  | "trialing"
  | "past_due"
  | "canceled"
  | "free";

export function billingState(shop: BillingRow): BillingState {
  if (shop.compPlan && isPlanId(shop.compPlan)) return "comped";
  if (!isPlanId(shop.plan) || shop.plan === "free") return "free";

  switch (shop.subscriptionStatus) {
    case "active":
      return "paying";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case null:
    case undefined:
      // A paid plan with no status is a checkout that never completed.
      return "free";
    default:
      return "canceled";
  }
}

/**
 * What this subscription is worth per month at list price, in USD cents.
 *
 * A yearly plan is divided by twelve rather than counted in the month it was
 * charged — otherwise MRR spikes on the anniversary and reads as growth. The
 * division rounds, so twelve months of a yearly plan can differ from the
 * invoice by a few cents; that is the right trade against a chart that lies.
 *
 * Comped accounts are worth zero. They are real users and real load, and
 * counting them as revenue is how a founder talks themselves into a number
 * nobody is paying.
 */
export function planMonthlyCents(shop: BillingRow): number {
  const state = billingState(shop);
  if (state === "comped" || state === "free") return 0;
  if (!isPlanId(shop.plan)) return 0;

  const plan = PLANS[shop.plan];
  return shop.subscriptionInterval === "year"
    ? Math.round(plan.yearlyCents / 12)
    : plan.monthlyCents;
}

/**
 * A billing row, optionally standing for several identical accounts.
 *
 * The overview counts every shop on the platform, and pulling one row per shop
 * to add up three numbers gets sillier the better the business does. The query
 * groups instead, and hands back each distinct billing shape with how many
 * accounts share it — so this stays one function whether it's given five real
 * shops or five thousand folded into a dozen groups.
 */
export type BillingGroup = BillingRow & { accounts?: number };

export type RevenueRollup = {
  /** Recurring revenue from subscriptions Stripe reports as active. */
  mrrCents: number;
  /** Annualised, the way an investor asks for it. */
  arrCents: number;
  /** Monthly value of subscriptions whose last payment failed. */
  atRiskCents: number;
  /** Monthly value trials would add if every one of them converted. */
  trialCents: number;
  /** What comped accounts would be worth at list price. */
  compedValueCents: number;
  /** Average revenue per paying account. */
  arpaCents: number;
  counts: Record<BillingState, number>;
  /** MRR split by plan, so a mix shift is visible. */
  byPlan: { plan: PlanId; accounts: number; mrrCents: number }[];
};

/** Everything the revenue tiles need, from one pass over the shop rows. */
export function rollUpRevenue(shopRows: BillingGroup[]): RevenueRollup {
  const counts: Record<BillingState, number> = {
    comped: 0,
    paying: 0,
    trialing: 0,
    past_due: 0,
    canceled: 0,
    free: 0,
  };
  const perPlan = new Map<PlanId, { accounts: number; mrrCents: number }>();

  let mrrCents = 0;
  let atRiskCents = 0;
  let trialCents = 0;
  let compedValueCents = 0;

  for (const shop of shopRows) {
    const n = shop.accounts ?? 1;
    if (n <= 0) continue;

    const state = billingState(shop);
    counts[state] += n;

    if (state === "comped") {
      const comped = shop.compPlan;
      if (comped && isPlanId(comped)) {
        compedValueCents += PLANS[comped].monthlyCents * n;
      }
      continue;
    }

    const monthly = planMonthlyCents(shop) * n;
    if (state === "paying") {
      mrrCents += monthly;
      if (isPlanId(shop.plan)) {
        const entry = perPlan.get(shop.plan) ?? { accounts: 0, mrrCents: 0 };
        perPlan.set(shop.plan, {
          accounts: entry.accounts + n,
          mrrCents: entry.mrrCents + monthly,
        });
      }
    } else if (state === "past_due") {
      atRiskCents += monthly;
    } else if (state === "trialing") {
      trialCents += monthly;
    }
  }

  return {
    mrrCents,
    arrCents: mrrCents * 12,
    atRiskCents,
    trialCents,
    compedValueCents,
    arpaCents: counts.paying > 0 ? Math.round(mrrCents / counts.paying) : 0,
    counts,
    byPlan: [...perPlan.entries()]
      .map(([plan, v]) => ({ plan, ...v }))
      .toSorted((a, b) => b.mrrCents - a.mrrCents),
  };
}

/* -------------------------------------------------------------------------- */
/*  Money that isn't all in one currency                                       */
/* -------------------------------------------------------------------------- */

export type CurrencyTotal = { currency: string; cents: number };

/**
 * Sellers price in their own currency, so platform-wide order volume is not
 * one number. Summing the cents columns would put nairas and euros in the same
 * pile and produce a figure that means nothing.
 *
 * So totals stay split by currency, largest first. Where a single headline is
 * needed, the biggest currency leads and the rest are named beside it.
 */
export function mergeCurrencyTotals(
  rows: Iterable<CurrencyTotal>,
): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = (row.currency || "USD").toUpperCase();
    totals.set(key, (totals.get(key) ?? 0) + row.cents);
  }
  return [...totals.entries()]
    .map(([currency, cents]) => ({ currency, cents }))
    .filter((t) => t.cents !== 0)
    .toSorted((a, b) => b.cents - a.cents);
}

/** "$4,210 · €300 · +2 more" — never a single fictional sum. */
export function formatCurrencyTotals(
  totals: CurrencyTotal[],
  limit = 2,
): string {
  if (totals.length === 0) return formatMoney(0, "USD");

  const shown = totals
    .slice(0, limit)
    .map((t) => formatMoney(t.cents, t.currency));
  const rest = totals.length - shown.length;

  return rest > 0 ? `${shown.join(" · ")} · +${rest} more` : shown.join(" · ");
}

/* -------------------------------------------------------------------------- */
/*  Change over time                                                           */
/* -------------------------------------------------------------------------- */

export type Delta = { value: string; direction: "up" | "down" | "flat" };

/**
 * The smallest previous period a percentage may be computed from.
 *
 * Below this, a ratio is arithmetically true and communicates nothing: one
 * signup last week and two hundred and eleven this week is "+21000%", which is
 * a number the overview really did display. It reads as a data error, and the
 * fact underneath it — "211, against 1" — is both smaller and more useful.
 *
 * Ten, because that is roughly where a percentage stops swinging wildly on one
 * extra event. Under it, the counts are reported instead.
 */
const MIN_BASE_FOR_PERCENT = 10;

/**
 * Period-on-period change, phrased for a tile.
 *
 * Growth from zero, or from a base too small to take a ratio of, is reported as
 * counts rather than as a percentage — which is the honest way to say "there
 * was nothing much to compare against".
 */
export function deltaOf(current: number, previous: number): Delta {
  if (current === previous) return { value: "No change", direction: "flat" };
  const diff = current - previous;
  const sign = diff > 0 ? "+" : "−";
  const magnitude = Math.abs(diff);

  if (previous === 0) {
    return {
      value: `${sign}${magnitude.toLocaleString()} vs none`,
      direction: diff > 0 ? "up" : "down",
    };
  }

  if (previous < MIN_BASE_FOR_PERCENT) {
    return {
      value: `${current.toLocaleString()} vs ${previous.toLocaleString()}`,
      direction: diff > 0 ? "up" : "down",
    };
  }

  const percent = Math.round((diff / previous) * 100);
  return {
    value: `${sign}${Math.abs(percent)}% vs previous`,
    direction: diff > 0 ? "up" : "down",
  };
}

/** Whole-number percentage, guarded against a zero denominator. */
export function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
