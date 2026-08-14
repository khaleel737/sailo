import type { Dictionary } from "@sailo/i18n";
import type { Shop } from "@sailo/db/schema";
import { taxOn } from "./pricing";

/**
 * What each plan costs, unlocks and limits — read by both apps.
 *
 * This lived in `apps/web/src/lib/plans.ts` until the mobile API needed it.
 * Every gate here is checked server-side and never trusted from the UI, and
 * the phone asks the same questions the dashboard does: how far back may this
 * shop's analytics reach, may it take card payments, has it hit its product
 * cap. A second copy of the table for the mobile router would have answered
 * those questions from whichever version was edited last — and the failure is
 * silent, because a window that is too wide still returns rows.
 *
 * It moved *into* core rather than beside it: `taxOn` above is core's already,
 * so this removes a package edge rather than adding one. `apps/web/src/lib/
 * plans.ts` is now a re-export, so nothing that imported `@/lib/plans` changed.
 */

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
  /** Block Sailo slots with busy time from the seller's own calendar feed. */
  calendarSync: boolean;
  /** Marketing email to contacts who opted in. */
  broadcasts: boolean;
  /**
   * Products the buyer keeps paying for — a gym month, a club, a course.
   *
   * Gated with `cardRails` rather than beside it by accident: a recurring
   * charge needs a card on file, and every other rail here settles out of
   * band with a human confirming each payment. A membership on a bank
   * transfer would be a monthly reminder to pay, not a subscription.
   */
  memberships: boolean;
  /**
   * Outbound webhooks, the REST API and the MCP endpoint — one flag, because
   * they are one feature.
   *
   * A key without events to trigger it and events with nothing to query are
   * each half an integration, and gating them separately would mean a seller
   * on one tier discovering their Zap can fire but cannot look anything up.
   * Business, alongside `affiliates` and `coupons`: this is the tier bought by
   * somebody running a business on other tools as well as this one.
   */
  integrations: boolean;
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
      calendarSync: false,
      broadcasts: false,
      memberships: false,
      integrations: false,
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
      calendarSync: true,
      broadcasts: false,
      memberships: false,
      integrations: false,
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
      calendarSync: true,
      broadcasts: true,
      memberships: true,
      integrations: true,
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
 * The fee as a percentage, for copy that has no shop to hand — the pricing
 * page, the marketing site, the legal documents.
 *
 * Exported so that no sentence anywhere writes the number itself. Every
 * translated string that mentions the fee interpolates this, because the
 * alternative was measured and it failed: the English copy was updated when
 * the fee was introduced and thirty-four translations were not, so every
 * non-English seller was told on the pricing page that Sailo took no
 * commission while Stripe collected one on every card sale.
 */
export const PLATFORM_FEE_LABEL = formatFeeBp(platformFeeBp({
  plan: "free",
  subscriptionStatus: null,
}));

/**
 * Basis points as a percentage, with no trailing zero to explain away: 50 is
 * "0.5%", not "0.50%", and 100 is "1%". `toFixed` alone gives the second form,
 * which reads like a rate quoted to two decimals for a reason.
 */
function formatFeeBp(bp: number): string {
  return `${Number((bp / 100).toFixed(2))}%`;
}

/**
 * The same fee, as the percentage a Stripe subscription wants.
 *
 * A recurring charge cannot name a fixed fee amount the way a one-time charge
 * does — the amount is not known until Stripe raises each invoice, and a
 * proration or a coupon changes it. `application_fee_percent` is Stripe's
 * answer, applied to whatever the invoice comes to.
 *
 * Derived from `platformFeeBp` rather than written again, because the whole
 * point of that function is that the number lives in one place: a membership
 * charged at a different rate from a one-time sale would be a second fee
 * policy nobody decided on, discovered in a payout months later.
 */
export function platformFeePercent(shop: BillingShape): number {
  return platformFeeBp(shop) / 100;
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
  order: {
    subtotalCents: number;
    discountCents: number;
    /*
     * Both required, not optional with a default.
     *
     * A caller that omits them is a caller that has not decided whether its
     * prices include tax, and the wrong answer overcharges silently. Making
     * the compiler ask is the only thing that catches the next call site.
     */
    taxRateBp: number | null;
    taxInclusive: boolean | null;
  },
): number {
  const net = Math.max(0, order.subtotalCents - order.discountCents);

  /*
   * Under inclusive pricing the tax is *inside* the prices, so it is inside
   * `net` too — and billing a percentage of it is billing the seller for
   * holding a government's money, which the note above says this must not do.
   * `pricing.ts` already strips it before paying affiliate commission; this
   * charged it. A €100 VAT-inclusive sale at 20% was billed on €100 rather
   * than the €83.33 the seller actually earned.
   */
  const includedTax = order.taxInclusive
    ? taxOn(net, order.taxRateBp ?? 0, true)
    : 0;

  return Math.round(((net - includedTax) * platformFeeBp(shop)) / 10_000);
}

/** "1%" — for the places that have to state the fee to a seller. */
export function platformFeeLabel(shop: BillingShape): string {
  return formatFeeBp(platformFeeBp(shop));
}

export function upgradeMessage(feature: keyof Features, what: string) {
  const plan = cheapestPlanWith(feature);
  return plan
    ? `${what} is available on ${plan.name}.`
    : `${what} isn't available on your plan.`;
}
