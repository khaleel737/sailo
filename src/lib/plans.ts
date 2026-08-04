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
  customDomain: boolean;
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
  /** Shopik's cut of card payments, in basis points. 0 on Business. */
  platformFeeBp: number;
  limits: Limits;
  features: Features;
  highlights: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Everything you need to take your first orders.",
    monthlyCents: 0,
    yearlyCents: 0,
    platformFeeBp: 0,
    limits: { products: 20, analyticsDays: 30 },
    features: {
      chatRails: true,
      manualRails: true,
      cardRails: false,
      coupons: false,
      affiliates: false,
      removeBadge: false,
      customDomain: false,
      csvExport: false,
    },
    highlights: [
      "20 products",
      "Unlimited categories",
      "WhatsApp, Telegram, Instagram, email ordering",
      "Bank transfer and cash on delivery",
      "Shipping and collection options",
      "Reviews, search and filters",
      "Invoices",
      "30 days of analytics",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Take card payments and grow with coupons and referrals.",
    monthlyCents: 999,
    yearlyCents: 9590, // ~20% off
    platformFeeBp: 200, // 2%
    limits: { products: 250, analyticsDays: 365 },
    features: {
      chatRails: true,
      manualRails: true,
      cardRails: true,
      coupons: true,
      affiliates: true,
      removeBadge: true,
      customDomain: false,
      csvExport: true,
    },
    highlights: [
      "250 products",
      "Card payments through your own Stripe or Paystack",
      "Discount codes",
      "Referral programme",
      "No Shopik badge",
      "A year of analytics",
      "Order export",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    tagline: "For shops where the 2% starts to hurt.",
    monthlyCents: 2999,
    yearlyCents: 28790,
    platformFeeBp: 0,
    limits: { products: null, analyticsDays: 365 * 3 },
    features: {
      chatRails: true,
      manualRails: true,
      cardRails: true,
      coupons: true,
      affiliates: true,
      removeBadge: true,
      customDomain: true,
      csvExport: true,
    },
    highlights: [
      "Unlimited products",
      "0% Shopik fee on card payments",
      "Custom domain",
      "Three years of analytics",
      "Priority support",
    ],
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

type BillingShape = Pick<Shop, "plan" | "subscriptionStatus">;

/** The plan a shop is actually entitled to right now. */
export function planFor(shop: BillingShape): Plan {
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

export function platformFeeBp(shop: BillingShape): number {
  return planFor(shop).platformFeeBp;
}

/** Shown when a gate blocks something, so the message names the cheapest fix. */
export function cheapestPlanWith(feature: keyof Features): Plan | null {
  for (const id of PLAN_IDS) {
    if (PLANS[id].features[feature]) return PLANS[id];
  }
  return null;
}

export function upgradeMessage(feature: keyof Features, what: string) {
  const plan = cheapestPlanWith(feature);
  return plan
    ? `${what} is available on ${plan.name}.`
    : `${what} isn't available on your plan.`;
}
