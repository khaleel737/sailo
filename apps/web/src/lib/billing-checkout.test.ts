import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  checkoutSessionParams,
  priceEnvKey,
  priceMismatch,
  type BillingInterval,
} from "./billing-checkout";
import { PLANS } from "./plans";

/**
 * The upgrade button had no tests at all, and shipped broken twice: once
 * because the Checkout Session carried a parameter the live account rejects,
 * and once because a stale customer id was handed to Stripe unchecked. Neither
 * is reachable from here — both need a live account — but everything that
 * *decides* what gets sent is pure, and that is what this covers.
 */

/** A Stripe price, shaped as `priceMismatch` reads it. */
function price(
  over: Partial<Pick<Stripe.Price, "active" | "currency" | "unit_amount">> & {
    interval?: BillingInterval;
  } = {},
): Parameters<typeof priceMismatch>[2] {
  return {
    active: over.active ?? true,
    currency: over.currency ?? "usd",
    unit_amount: over.unit_amount ?? PLANS.pro.monthlyCents,
    recurring: { interval: over.interval ?? "month" } as Stripe.Price.Recurring,
  };
}

describe("priceEnvKey", () => {
  /*
   * This mapping is silent when it is wrong: a bad key reads as "No Stripe
   * price configured", which sounds like missing config rather than a typo.
   * The four names are pinned to what the deployment actually sets.
   */
  it("names the four variables the environment defines", () => {
    expect(priceEnvKey("pro", "month")).toBe("STRIPE_PRICE_PRO_MONTHLY");
    expect(priceEnvKey("pro", "year")).toBe("STRIPE_PRICE_PRO_YEARLY");
    expect(priceEnvKey("business", "month")).toBe("STRIPE_PRICE_BUSINESS_MONTHLY");
    expect(priceEnvKey("business", "year")).toBe("STRIPE_PRICE_BUSINESS_YEARLY");
  });
});

describe("priceMismatch", () => {
  it("passes a price that matches the advertised plan", () => {
    expect(priceMismatch("pro", "month", price())).toBeNull();
    expect(
      priceMismatch("business", "year", price({
        unit_amount: PLANS.business.yearlyCents,
        interval: "year",
      })),
    ).toBeNull();
  });

  /* Business once advertised $19.99 while Stripe charged $29.99. Nothing links
     the pricing table to the price id, so this is the only thing that would. */
  it("catches a price that charges more than the table shows", () => {
    const reason = priceMismatch("pro", "month", price({ unit_amount: 2999 }));
    expect(reason).toContain("$29.99");
    expect(reason).toContain("$19.00");
  });

  it("catches an archived price", () => {
    expect(priceMismatch("pro", "month", price({ active: false }))).toContain("archived");
  });

  it("catches a price in the wrong currency", () => {
    expect(priceMismatch("pro", "month", price({ currency: "eur" }))).toContain("EUR");
  });

  /* Yearly plans cost less per month, so a monthly price id in the yearly slot
     undercharges rather than overcharges — no error surfaces at checkout. */
  it("catches a monthly price offered as the yearly plan", () => {
    expect(priceMismatch("pro", "year", price({ interval: "month" }))).not.toBeNull();
  });
});

describe("checkoutSessionParams", () => {
  const params = checkoutSessionParams({
    shopId: "shop_1",
    plan: "pro",
    price: "price_123",
    customer: "cus_123",
  });

  it("subscribes the given customer to the given price", () => {
    expect(params.mode).toBe("subscription");
    expect(params.customer).toBe("cus_123");
    expect(params.line_items).toEqual([{ price: "price_123", quantity: 1 }]);
  });

  /*
   * The webhook finds the shop three ways because any one of them can be
   * absent depending on how the subscription was created. Dropping one is
   * silent — the payment succeeds and the plan never changes.
   */
  it("carries the shop id everywhere the webhook looks for it", () => {
    expect(params.client_reference_id).toBe("shop_1");
    expect(params.metadata).toMatchObject({ shopId: "shop_1", plan: "pro" });
    expect(params.subscription_data?.metadata).toMatchObject({
      shopId: "shop_1",
      plan: "pro",
    });
  });

  /*
   * The regression this file was written for. Managed Payments is on by
   * default on newer Stripe accounts and rejects `adaptive_pricing.enabled:
   * false`, so these two have to travel together or every upgrade 400s.
   */
  it("opts out of Managed Payments alongside Adaptive Pricing", () => {
    expect(params.adaptive_pricing).toEqual({ enabled: false });
    expect(params.managed_payments).toEqual({ enabled: false });
  });

  /*
   * The second pair that has to travel together. `automatic_tax` on its own
   * is a 400: the customer this session names has no address, and Stripe will
   * not infer a tax jurisdiction from nothing.
   */
  it("pairs Stripe Tax with the address update it requires", () => {
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.customer_update).toMatchObject({ address: "auto" });
  });

  /* Pinning these locks out everything configured in the Dashboard. */
  it("lets Stripe decide the payment methods", () => {
    expect(params).not.toHaveProperty("payment_method_types");
  });

  it("returns the seller to billing, whichever way they leave", () => {
    expect(params.success_url).toContain("/admin/settings/billing?checkout=success");
    expect(params.cancel_url).toContain("/admin/settings/billing?checkout=cancelled");
  });
});
