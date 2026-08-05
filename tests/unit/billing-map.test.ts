import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freePlanFields, planFromPriceId, subscriptionFields } from "@/lib/billing-map";

const PRICES = {
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
  STRIPE_PRICE_PRO_YEARLY: "price_pro_y",
  STRIPE_PRICE_BUSINESS_MONTHLY: "price_biz_m",
  STRIPE_PRICE_BUSINESS_YEARLY: "price_biz_y",
};

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const [k, v] of Object.entries(PRICES)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const sub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  cancel_at_period_end: false,
  metadata: {},
  items: { data: [{ price: { id: PRICES.STRIPE_PRICE_BUSINESS_MONTHLY, recurring: { interval: "month" } } }] },
  ...over,
});

describe("planFromPriceId", () => {
  it.each([
    ["price_pro_m", "pro"],
    ["price_pro_y", "pro"],
    ["price_biz_m", "business"],
    ["price_biz_y", "business"],
  ])("maps %s to %s", (id, plan) => {
    expect(planFromPriceId(id)).toBe(plan);
  });

  it.each([[undefined], ["price_retired"], [""]])("maps %s to nothing", (id) => {
    expect(planFromPriceId(id as string | undefined)).toBeNull();
  });
});

describe("subscriptionFields", () => {
  it("takes the plan from the price, not from metadata", () => {
    // A seller switching plan inside Stripe's portal changes the price, not
    // whatever metadata we wrote when they first subscribed.
    const fields = subscriptionFields(
      sub({ metadata: { plan: "free" } }) as never,
    );
    expect(fields.plan).toBe("business");
  });

  it("falls back to free when the price is one we retired", () => {
    // A price we no longer sell must not keep granting the plan it used to.
    const fields = subscriptionFields(
      sub({ items: { data: [{ price: { id: "price_old_2999" } }] } }) as never,
    );
    expect(fields.plan).toBe("free");
  });

  it("carries status, interval and cancellation", () => {
    const fields = subscriptionFields(
      sub({ status: "past_due", cancel_at_period_end: true }) as never,
    );
    expect(fields.subscriptionStatus).toBe("past_due");
    expect(fields.subscriptionInterval).toBe("month");
    expect(fields.cancelAtPeriodEnd).toBe(true);
  });

  it("converts the period end from unix seconds", () => {
    const at = 1_800_000_000;
    const fields = subscriptionFields(
      sub({
        items: {
          data: [
            {
              price: { id: PRICES.STRIPE_PRICE_PRO_YEARLY, recurring: { interval: "year" } },
              current_period_end: at,
            },
          ],
        },
      }) as never,
    );
    expect(fields.currentPeriodEnd?.getTime()).toBe(at * 1_000);
  });

  it("survives a subscription with no items", () => {
    const fields = subscriptionFields(sub({ items: { data: [] } }) as never);
    expect(fields.plan).toBe("free");
    expect(fields.currentPeriodEnd).toBeNull();
  });
});

describe("freePlanFields", () => {
  it("clears everything the subscription set", () => {
    const f = freePlanFields();
    expect(f.plan).toBe("free");
    expect(f.stripeSubscriptionId).toBeNull();
    expect(f.subscriptionStatus).toBeNull();
    expect(f.currentPeriodEnd).toBeNull();
    expect(f.cancelAtPeriodEnd).toBe(false);
  });

  it("stamps a fresh time on every call", async () => {
    // A module-level `new Date()` froze at import, so every downgrade for the
    // life of a server instance carried the same timestamp.
    const first = freePlanFields();
    await new Promise((r) => setTimeout(r, 5));
    expect(freePlanFields().updatedAt.getTime()).toBeGreaterThan(
      first.updatedAt.getTime(),
    );
  });
});
