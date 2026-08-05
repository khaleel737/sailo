import type { Dictionary } from "@/i18n";
import type { Shop } from "@/db/schema";

export const PLAN_IDS = ["free", "pro", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Everything a plan unlocks. Checked server-side, never trusted from the UI. */
export type Features = {
  /** Chat handoff rails — WhatsApp, Telegram, Instagram, email, phone. */
  chatRails: boolean;
  /** Manual settlement — bank transfer, cash on delivery. */
  manualRails: boolean;
  /** Buyer pays by card through the seller's own gateway. */
  cardRails: boolean;
  coupons: boolean;
  affiliates: boolean;
  removeBadge: boolean;
  csvExport: boolean;
};

export type Limits = {
  /** null means unlimited. */
  products: number | null;
  analyticsDays: number;
};

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  monthlyCents: number;
  yearlyCents: number;
  limits: Limits;
  features: Features;
  /** Dictionary keys under `highlights`, resolved at render time. */
  highlights: (keyof Dictionary["highlights"])[];
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Everything you need to take your first orders.",
    monthlyCents: 0,
    yearlyCents: 0,
    limits: { products: 20, analyticsDays: 30 },
    features: {
      chatRails: true,
      manualRails: true,
      cardRails: false,
      coupons: false,
      affiliates: false,
      removeBadge: false,
      csvExport: false,
    },
    highlights: [
      "free1", "free2", "free3", "free4", "free5",
      "free6", "free7", "free8", "free9",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Room to grow, and your shop looks like your own.",
    monthlyCents: 999,
    yearlyCents: 9590, // ~20% off
    limits: { products: 250, analyticsDays: 365 },
    features: {
      chatRails: true,
      manualRails: true,
      cardRails: false,
      coupons: false,
      affiliates: false,
      removeBadge: true,
      csvExport: true,
    },
    highlights: ["pro1", "pro2", "pro3", "pro4", "pro5"],
  },
  business: {
    id: "business",
    name: "Business",
    tagline: "Card payments, promotions and referrals — the tools that grow revenue.",
    monthlyCents: 1999,
    yearlyCents: 19190,
    limits: { products: null, analyticsDays: 365 * 3 },
    features: {
      chatRails: true,
      manualRails: true,
      cardRails: true,
      coupons: true,
      affiliates: true,
      removeBadge: true,
      csvExport: true,
    },
    highlights: ["biz1", "biz2", "biz3", "biz4", "biz5", "biz6"],
  },
};

export const PAID_PLAN_IDS = PLAN_IDS.filter((id) => id !== "free");

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

/**
 * Statuses that still grant paid features. `past_due` is included on purpose —
 * a failed renewal shouldn't take a seller's shop down mid-sale; Stripe retries
 * for days and only then moves to `canceled` or `unpaid`.
 */
const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

type BillingShape = Pick<Shop, "plan" | "subscriptionStatus"> & {
  /** Optional so callers holding only the two billing columns still fit. */
  compPlan?: string | null;
};

/** The plan a shop is actually entitled to right now. */
export function planFor(shop: BillingShape): Plan {
  /*
   * A plan we granted from /hq outranks whatever Stripe says. It has to: the
   * billing sync rewrites `plan` and `subscriptionStatus` from Stripe on every
   * visit to the billing page, so a comp expressed in those columns would be
   * wiped by the seller simply looking at their own bill.
   */
  if (shop.compPlan && isPlanId(shop.compPlan)) return PLANS[shop.compPlan];

  if (!isPlanId(shop.plan) || shop.plan === "free") return PLANS.free;
  if (!shop.subscriptionStatus) return PLANS.free;
  return ENTITLED_STATUSES.has(shop.subscriptionStatus)
    ? PLANS[shop.plan]
    : PLANS.free;
}

export function can(shop: BillingShape, feature: keyof Features): boolean {
  return planFor(shop).features[feature];
}

export function productLimit(shop: BillingShape): number | null {
  return planFor(shop).limits.products;
}

/** True when the shop is at or over its product cap. */
export function atProductLimit(shop: BillingShape, current: number): boolean {
  const limit = productLimit(shop);
  return limit !== null && current >= limit;
}

/** Selectable analytics ranges, in days. */
export const ANALYTICS_RANGES = [7, 30, 90, 365, 1095] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function analyticsLimit(shop: BillingShape): number {
  return planFor(shop).limits.analyticsDays;
}

/**
 * Clamps a requested range to the plan's allowance. Enforced here rather than
 * in the UI so a hand-typed query string can't read further back than paid for.
 */
export function clampAnalyticsRange(
  shop: BillingShape,
  requested: number | undefined,
): AnalyticsRange {
  const limit = analyticsLimit(shop);
  const allowed = ANALYTICS_RANGES.filter((r) => r <= limit);
  const max = allowed[allowed.length - 1] ?? 7;
  if (!requested || !ANALYTICS_RANGES.includes(requested as AnalyticsRange)) {
    return Math.min(30, max) as AnalyticsRange;
  }
  return Math.min(requested, max) as AnalyticsRange;
}

/** Shown when a gate blocks something, so the message names the cheapest fix. */
export function cheapestPlanWith(feature: keyof Features): Plan | null {
  for (const id of PLAN_IDS) {
    if (PLANS[id].features[feature]) return PLANS[id];
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  What Sailo keeps from a card sale                                          */
/* -------------------------------------------------------------------------- */

/**
 * The platform fee, in basis points — 100 = 1%.
 *
 * Taken as a function of the plan rather than a constant because that is where
 * this ends up: Shopify's equivalent surcharge runs 2% on Basic down to 0.2%
 * on Plus, so the bigger the subscription the smaller the cut. Cards are a
 * single tier here today, so there is one number — but the shape is ready for
 * the day there are several, and every caller already passes the shop.
 */
export function platformFeeBp(_shop: BillingShape): number {
  return 100;
}

/**
 * The fee on one order, in minor units.
 *
 * Charged on the goods alone. Delivery is usually money the seller hands to a
 * courier, and tax is money they collect for a government and never owned —
 * billing a percentage of either means charging them for holding someone
 * else's money. A discount comes off first, because 1% of a price nobody paid
 * is not 1% of a sale.
 */
export function platformFeeCents(
  shop: BillingShape,
  order: { subtotalCents: number; discountCents: number },
): number {
  const goods = Math.max(0, order.subtotalCents - order.discountCents);
  return Math.round((goods * platformFeeBp(shop)) / 10_000);
}

/** "1%" — for the places that have to state the fee to a seller. */
export function platformFeeLabel(shop: BillingShape): string {
  const bp = platformFeeBp(shop);
  return bp % 100 === 0 ? `${bp / 100}%` : `${(bp / 100).toFixed(2)}%`;
}

export function upgradeMessage(feature: keyof Features, what: string) {
  const plan = cheapestPlanWith(feature);
  return plan
    ? `${what} is available on ${plan.name}.`
    : `${what} isn't available on your plan.`;
}
