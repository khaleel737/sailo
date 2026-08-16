import { isPlanId, PLAN_IDS } from "@sailo/core/plans";

export type SubscriptionLike = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  metadata?: Record<string, string> | null;
  items: {
    data: Array<{
      price: { id: string; recurring?: { interval?: string } | null };
      current_period_end?: number;
    }>;
  };
};

/** Reverse lookup from the configured env price ids. */
export function planFromPriceId(priceId: string | undefined) {
  if (!priceId) return null;
  for (const planId of PLAN_IDS) {
    for (const interval of ["MONTHLY", "YEARLY"]) {
      const key = `STRIPE_PRICE_${planId.toUpperCase()}_${interval}`;
      if (process.env[key] === priceId) return planId;
    }
  }
  return null;
}

/**
 * Maps a Stripe subscription onto our columns. The plan comes from the price
 * id rather than subscription metadata, so a plan switch made inside Stripe's
 * billing portal is still read correctly.
 */
export function subscriptionFields(sub: SubscriptionLike) {
  const item = sub.items.data[0];
  const plan = planFromPriceId(item?.price.id) ?? sub.metadata?.plan ?? "free";
  const periodEnd = item?.current_period_end;

  return {
    plan: isPlanId(plan) ? plan : "free",
    stripeSubscriptionId: sub.id,
    subscriptionStatus: sub.status,
    subscriptionInterval: item?.price.recurring?.interval ?? null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    updatedAt: new Date(),
  };
}

/**
 * Columns that put a shop back on the free plan. A function, not a constant:
 * a module-level `new Date()` freezes at import and every downgrade for the
 * life of that instance would be stamped with the same time.
 */
export function freePlanFields() {
  return {
    plan: "free" as const,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    subscriptionInterval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    updatedAt: new Date(),
  };
}
