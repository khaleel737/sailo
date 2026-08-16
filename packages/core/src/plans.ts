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
   * A card on file is *necessary* for this and no longer *sufficient*: card
   * settles on every tier now, so the old reasoning — that this tracked
   * `cardRails` because a recurring charge needs a card — would drop
   * memberships onto Free the day the fee ladder shipped. It stays on
   * Business as a deliberate entitlement, and the two flags are independent.
   * Anything that reads one to infer the other is a bug.
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
  /**
   * What Sailo keeps from a card sale on this plan, in basis points.
   *
   * On the plan rather than in a `switch` inside `platformFeeBp` so that the
   * price, the entitlements and the fee for a tier are one object a reader can
   * take in at once — the three numbers that decide whether a seller should be
   * on this tier should not live in three places.
   */
  feeBp: number;
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
    feeBp: 300,
    limits: { products: 10, analyticsDays: 7 },
    features: {
      chatRails: true,
      manualRails: true,
      /*
       * Card settles on every tier, including this one.
       *
       * It was Business-only, which put the most-wanted feature in the product
       * behind the highest price and left the other 95% of shops worth nothing
       * at all — Sailo carried their Stripe webhooks, storage and support and
       * billed for none of it. The fee ladder replaces that wall: everyone can
       * take a card, and what a plan buys is a smaller cut of it.
       */
      cardRails: true,
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
      "free6", "free7", "free8", "free9", "biz2",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Room to grow, and your shop looks like your own.",
    monthlyCents: 1900,
    yearlyCents: 18000, // ~21% off
    feeBp: 200,
    limits: { products: 100, analyticsDays: 365 },
    features: {
      chatRails: true,
      manualRails: true,
      cardRails: true,
      /*
       * Discount codes came down from Business. A code is a basic selling
       * tool, not a growth-team feature, and Pro needed a reason to exist
       * beyond removing a badge now that card no longer marks the boundary.
       */
      coupons: true,
      affiliates: false,
      removeBadge: true,
      csvExport: true,
      calendarSync: true,
      broadcasts: false,
      memberships: false,
      integrations: false,
    },
    highlights: ["pro1", "pro2", "biz3", "pro3", "pro4", "pro5"],
  },
  business: {
    id: "business",
    name: "Business",
    tagline: "The lowest fee on card, plus the tools that grow revenue.",
    monthlyCents: 4900,
    yearlyCents: 46800, // ~20% off
    feeBp: 100,
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
    /*
     * `biz2` (card through your own Stripe) moved to Free and `biz3` (discount
     * codes) to Pro, because both are true of those tiers now. The keys keep
     * their names rather than being renamed across 35 dictionaries — a rename
     * touches every translation and risks the drift `PLATFORM_FEE_RANGE_LABEL`
     * exists to prevent, while reusing them costs nothing but an odd prefix.
     *
     * This list is short for what Business actually carries — memberships,
     * broadcasts and the API have never had highlight strings. New copy for
     * them is the one piece of this change that needs a translator.
     */
    highlights: ["biz1", "biz4", "biz5", "biz6"],
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
 * Falls as the plan rises: 3% on Free, 2% on Pro, 1% on Business. That is the
 * shape every comparable platform converged on — Linktree runs 12/9/0, Podia
 * 5/0, Shopify 2/1/0.6 — and Sailo had it inverted, charging its largest
 * sellers a percentage while the smallest paid nothing on any rail.
 *
 * Read off the plan rather than branched on here, so the fee cannot disagree
 * with the table a reader just looked at.
 */
export function platformFeeBp(shop: BillingShape): number {
  return planFor(shop).feeBp;
}

/**
 * The fee ladder as one phrase — "1–3%".
 *
 * For the sentences that have no shop to hand: the marketing pages, the FAQ
 * and the legal documents, all of which describe the fee to somebody who has
 * not chosen a plan yet. A single number cannot be right for them any more,
 * and picking one plan's rate to stand for all three would understate or
 * overstate it depending on which was picked.
 *
 * Written as a range, low first, because it drops into the `{fee}` slot the
 * copy already has — "card sales carry a {fee} fee" — and stays grammatical
 * in all thirty-five languages without a translator touching one of them. A
 * list ("3%, 2% or 1%") does not: it collides with the article in front of it
 * in English and with case endings in the Slavic dictionaries.
 *
 * Derived from `PLANS` rather than typed out, for the reason the old
 * single-fee constant existed: the English copy was updated when the fee was
 * introduced and thirty-four translations were not, so every non-English
 * seller was told Sailo took no commission while Stripe collected one on
 * every card sale. Renamed from `PLATFORM_FEE_RANGE_LABEL` on purpose — the old
 * name promised one number, and every call site had to be re-read rather than
 * silently inheriting a new meaning.
 */
export const PLATFORM_FEE_RANGE_LABEL = (() => {
  const bps = PLAN_IDS.map((id) => PLANS[id].feeBp);
  const low = Math.min(...bps);
  const high = Math.max(...bps);
  return low === high
    ? formatFeeBp(low)
    // En dash, not a hyphen: this is a range, and it is set in running prose.
    : `${Number((low / 100).toFixed(2))}–${formatFeeBp(high)}`;
})();

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
 * else's money. A discount comes off first, because a percentage of a price
 * nobody paid is not a percentage of a sale.
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

/** "2%" — this shop's own rate, for the places that state it to its seller. */
export function platformFeeLabel(shop: BillingShape): string {
  return formatFeeBp(platformFeeBp(shop));
}

export function upgradeMessage(feature: keyof Features, what: string) {
  const plan = cheapestPlanWith(feature);
  return plan
    ? `${what} is available on ${plan.name}.`
    : `${what} isn't available on your plan.`;
}
