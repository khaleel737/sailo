/*
 * No `server-only` here on purpose: this builds a plain object and holds no
 * secret, and `scripts/check-live.ts` imports it as plain Node to prove the
 * live deployment accepts these exact parameters.
 */
import type Stripe from "stripe";
import { appUrl } from "@/lib/app-url";
import { PLANS, type PlanId } from "@/lib/plans";

/* ===========================================================================
   The Checkout Session, described once

   This file exists because of a bug that reached every seller: upgrading was
   broken on production for days while every local test passed, because
   `scripts/check-live.ts` — the check whose entire job is to prove the live
   deployment works — subscribed its throwaway shop with
   `subscriptions.create` and never touched `checkout.sessions.create` at all.
   It proved the webhook half of billing and skipped the half a seller reaches
   first.

   The obvious repair is to make the check create a session too. That only
   works if it creates the *same* session: a check that hand-rolls its own
   parameters drifts from the action within a release and goes back to proving
   nothing. So the parameters live here, both callers build from this, and the
   check exercises the real thing.
=========================================================================== */

/** The two intervals a plan can be billed on. */
export type BillingInterval = "month" | "year";

/**
 * The env var holding the Stripe price id for a plan and interval.
 *
 * Pure, and exported, so a test can assert the naming without Stripe or a
 * process environment — this mapping is silent when it is wrong. A typo here
 * reads as "No Stripe price configured", which sounds like missing config
 * rather than a bad lookup.
 */
export function priceEnvKey(plan: PlanId, interval: BillingInterval) {
  return `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}LY`;
}

/**
 * Why a Stripe price cannot be charged for this plan, or null if it can.
 *
 * The pricing table reads `plans.ts`; the charge comes from a price id in the
 * environment, and nothing links the two — Business once advertised $19.99
 * while Stripe was set up to charge $29.99. Returning the reason rather than
 * throwing keeps this callable from a check script that wants to report on
 * every plan instead of dying on the first bad one.
 */
export function priceMismatch(
  plan: PlanId,
  interval: BillingInterval,
  price: Pick<Stripe.Price, "active" | "currency" | "unit_amount" | "recurring">,
): string | null {
  const definition = PLANS[plan];
  const expected =
    interval === "year" ? definition.yearlyCents : definition.monthlyCents;

  if (
    price.active &&
    price.currency === "usd" &&
    price.unit_amount === expected &&
    price.recurring?.interval === interval
  ) {
    return null;
  }

  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return (
    `does not match the advertised ${definition.name} ${interval}ly plan ` +
    `(expected ${dollars(expected)} USD, got ` +
    `${dollars(price.unit_amount ?? 0)} ${price.currency.toUpperCase()}/` +
    `${price.recurring?.interval ?? "one-off"}` +
    `${price.active ? "" : ", archived"}). Run scripts/stripe-setup.ts.`
  );
}

/**
 * Every parameter the upgrade Checkout Session is created with.
 *
 * Notable absences are as deliberate as the entries. There is no
 * `payment_method_types`: pinning it would lock out everything configured in
 * the Dashboard and cost conversion, so the eligible methods are resolved by
 * Stripe at runtime.
 */
export function checkoutSessionParams({
  shopId,
  plan,
  price,
  customer,
}: {
  shopId: string;
  plan: Exclude<PlanId, "free">;
  /**
   * A Stripe price id, already checked against `priceMismatch`. The billing
   * interval rides along with it — there is no separate parameter, because two
   * sources for one fact is how a yearly plan ends up billed monthly.
   */
  price: string;
  /** A customer id already known to exist — see `billing-customer.ts`. */
  customer: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: shopId,
    subscription_data: { metadata: { shopId, plan } },
    metadata: { shopId, plan },
    allow_promotion_codes: true,

    /*
     * Adaptive Pricing would convert $19.99 into the seller's local currency
     * at checkout. The plan table quotes USD and nothing localises it, so a
     * German seller would read "$19.99" here and "€18.04" there. Turn it back
     * on the day plan prices are localised too.
     *
     * `managed_payments` is not a second opinion about the same thing — it is
     * what makes the line above legal. Managed Payments is Stripe's merchant
     * of record product and it is ON by default on newer accounts, including
     * the live one this deploys against. While it is on, Stripe rejects
     * `adaptive_pricing[enabled]=false` outright and every upgrade 400s with
     * "adaptive_pricing[enabled] must be `true` when Managed Payments is
     * enabled". Opting the session out is the escape hatch Stripe's own error
     * names, and it keeps prices in the currency the pricing table advertises.
     *
     * This never reproduced locally: the test account does not have Managed
     * Payments enabled, so the two accounts disagree about a default. That is
     * the kind of drift only a live check catches, which is why one now runs.
     */
    adaptive_pricing: { enabled: false },
    managed_payments: { enabled: false },

    /*
     * Tags the session in the Dashboard so upgrade traffic can be told apart
     * from the storefront's own card checkouts, which share this account.
     * Stripe asks for a random suffix; this one is fixed because the value is
     * a label for a flow, not an id for a session.
     */
    integration_identifier: "sailo-plan-upgrade-kqmzrtwv",

    success_url: `${appUrl()}/admin/settings/billing?checkout=success`,
    cancel_url: `${appUrl()}/admin/settings/billing?checkout=cancelled`,
  };
}
