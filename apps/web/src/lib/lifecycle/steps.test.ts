import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_STEPS,
  LIFECYCLE_STEP_IDS,
  canTakeMoney,
  isRetirable,
  isSellable,
  lifecycleGap,
  lifecycleStep,
  nextLifecycleStep,
} from "./steps";
import type { LifecycleShop, LifecycleState } from "./state";

/**
 * The ladder, exercised as a whole rather than a rung at a time.
 *
 * Every assertion here is about a seller at a point in time, because that is
 * the only thing the pipeline actually decides: given this account on this
 * day, which email — if any. The rungs themselves are trivial; what is worth
 * testing is the interaction between them, which is where the failures that
 * matter live. A rung firing for somebody who has already done the thing, a
 * rung firing months late on a fleet that predates the feature, and a rung
 * that quietly never fires at all are all failures nobody notices from the
 * outside until conversion has already been lost.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const NOW = new Date("2026-06-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const shop = (over: Partial<LifecycleShop> = {}): LifecycleShop => ({
  id: "shop-1",
  handle: "forno",
  name: "Forno Nove",
  createdAt: ago(30 * DAY),
  plan: "free",
  subscriptionStatus: null,
  compPlan: null,
  avatarUrl: null,
  logoUrl: null,
  socials: [],
  stripeChargesEnabled: false,
  ...over,
});

/** Signed up, did nothing, address confirmed. The top of the ladder. */
const state = (over: Partial<LifecycleState> = {}): LifecycleState => ({
  userId: "user-1",
  email: "seller@example.com",
  name: "Amira Haddad",
  emailVerified: true,
  signedUpAt: ago(3 * HOUR),
  shop: null,
  productCount: 0,
  firstProductAt: null,
  railCount: 0,
  orderCount: 0,
  firstOrderAt: null,
  sent: new Set<string>(),
  lastLifecycleAt: null,
  ...over,
});

const nextId = (s: LifecycleState, now = NOW) =>
  nextLifecycleStep(s, now)?.id ?? null;

describe("the ladder's shape", () => {
  it("declares every id exactly once, in the order it is climbed", () => {
    expect(LIFECYCLE_STEPS.map((s) => s.id)).toEqual([...LIFECYCLE_STEP_IDS]);
  });

  it("gives every rung but the last chance an expiry", () => {
    for (const step of LIFECYCLE_STEPS) {
      if (step.id === "catch_up") {
        expect(step.staleAfterMs).toBeNull();
        continue;
      }
      expect(step.staleAfterMs, `${step.id} never goes stale`).toBeGreaterThan(0);
    }
  });
});

describe("signed up, no shop", () => {
  it("says nothing for the first couple of hours", () => {
    expect(nextId(state({ signedUpAt: ago(30 * 60_000) }))).toBeNull();
  });

  it("nudges once the signup has clearly stalled", () => {
    expect(nextId(state({ signedUpAt: ago(3 * HOUR) }))).toBe("no_shop_1");
  });

  it("climbs to the next rung only once the first is spent", () => {
    const stalled = { signedUpAt: ago(3 * DAY) };
    expect(nextId(state(stalled))).toBe("no_shop_1");
    expect(nextId(state({ ...stalled, sent: new Set(["no_shop_1"]) }))).toBe(
      "no_shop_2",
    );
  });

  it("stops for good after the last one", () => {
    expect(
      nextId(
        state({
          signedUpAt: ago(40 * DAY),
          sent: new Set(["no_shop_1", "no_shop_2", "no_shop_3", "catch_up"]),
        }),
      ),
    ).toBeNull();
  });

  it("drops the whole branch the moment a shop exists", () => {
    const built = state({ signedUpAt: ago(3 * DAY), shop: shop({ createdAt: ago(HOUR) }) });
    expect(nextId(built)).toBe("shop_live");
  });
});

describe("the shop is built", () => {
  it("waits out the first twenty minutes", () => {
    const s = state({ shop: shop({ createdAt: ago(5 * 60_000) }) });
    expect(nextId(s)).toBeNull();
  });

  it("sends the link to everyone, product or not", () => {
    const withStock = state({
      shop: shop({ createdAt: ago(HOUR) }),
      productCount: 4,
      firstProductAt: ago(30 * 60_000),
      railCount: 1,
    });
    expect(nextId(withStock)).toBe("shop_live");
  });

  it("does not announce a shop that has been live for a week", () => {
    // The backfill case: a fleet that predates the pipeline must not be told
    // its months-old shop has just gone live.
    const old = state({
      signedUpAt: ago(40 * DAY),
      shop: shop({ createdAt: ago(30 * DAY) }),
      productCount: 2,
      firstProductAt: ago(29 * DAY),
      railCount: 1,
    });
    expect(nextId(old)).not.toBe("shop_live");
  });

  it("asks for a product once there is still none", () => {
    const empty = state({
      shop: shop({ createdAt: ago(3 * DAY) }),
      sent: new Set(["shop_live"]),
    });
    expect(nextId(empty)).toBe("no_product_1");
  });

  it("never asks again once one exists", () => {
    const stocked = state({
      shop: shop({ createdAt: ago(3 * DAY) }),
      productCount: 1,
      firstProductAt: ago(HOUR),
      railCount: 1,
      sent: new Set(["shop_live"]),
    });
    expect(nextId(stocked)).not.toBe("no_product_1");
  });
});

describe("no way to be paid", () => {
  const stocked = (over: Partial<LifecycleState> = {}) =>
    state({
      shop: shop({ createdAt: ago(5 * DAY) }),
      productCount: 2,
      firstProductAt: ago(2 * DAY),
      sent: new Set(["shop_live"]),
      ...over,
    });

  it("fires a day after the first product when nothing is switched on", () => {
    expect(nextId(stocked())).toBe("no_rail");
  });

  it("counts a manual rail as being able to take money", () => {
    // The differentiator: a cash-on-delivery seller is fully set up, and
    // telling them their working shop is broken is the bug this guards.
    expect(canTakeMoney(stocked({ railCount: 1 }))).toBe(true);
    expect(nextId(stocked({ railCount: 1 }))).not.toBe("no_rail");
  });

  it("counts Stripe on its own too", () => {
    const withStripe = stocked({
      shop: shop({ createdAt: ago(5 * DAY), stripeChargesEnabled: true }),
    });
    expect(canTakeMoney(withStripe)).toBe(true);
    expect(nextId(withStripe)).not.toBe("no_rail");
  });
});

describe("set up but not selling", () => {
  const ready = (over: Partial<LifecycleState> = {}) =>
    state({
      shop: shop({ createdAt: ago(16 * DAY) }),
      productCount: 3,
      // Old enough that both traffic rungs have come due — the second is
      // twelve days after the catalogue started, not after the first email.
      firstProductAt: ago(14 * DAY),
      railCount: 1,
      sent: new Set(["shop_live"]),
      ...over,
    });

  it("is only reachable once the shop can actually sell", () => {
    expect(isSellable(ready())).toBe(true);
    expect(isSellable(ready({ railCount: 0 }))).toBe(false);
  });

  it("nudges about traffic, then about tactics", () => {
    expect(nextId(ready())).toBe("no_orders_1");
    expect(
      nextId(ready({ sent: new Set(["shop_live", "no_orders_1"]) })),
    ).toBe("no_orders_2");
  });

  it("goes quiet the moment an order lands", () => {
    const sold = ready({ orderCount: 1, firstOrderAt: ago(2 * HOUR) });
    expect(nextId(sold)).toBeNull();
  });
});

describe("converted", () => {
  const sold = (over: Partial<LifecycleState> = {}) =>
    state({
      shop: shop({ createdAt: ago(30 * DAY) }),
      productCount: 3,
      firstProductAt: ago(28 * DAY),
      railCount: 1,
      orderCount: 1,
      firstOrderAt: ago(2 * DAY),
      sent: new Set(["shop_live"]),
      ...over,
    });

  it("holds the celebration back a day, so it doesn't collide with the order mail", () => {
    expect(nextId(sold({ firstOrderAt: ago(2 * HOUR) }))).toBeNull();
    expect(nextId(sold())).toBe("first_sale");
  });

  it("asks for money only after three sales, and only on the free plan", () => {
    const spent = new Set(["shop_live", "first_sale"]);
    const base = { firstOrderAt: ago(20 * DAY), sent: spent };

    expect(nextId(sold({ ...base, orderCount: 2 }))).toBeNull();
    expect(nextId(sold({ ...base, orderCount: 3 }))).toBe("upgrade");
  });

  it("reads entitlement, not the plan column", () => {
    const spent = new Set(["shop_live", "first_sale"]);
    const base = { firstOrderAt: ago(20 * DAY), orderCount: 5, sent: spent };

    // A lapsed subscription is a free shop, whatever `plan` still says.
    const lapsed = sold({
      ...base,
      shop: shop({ createdAt: ago(30 * DAY), plan: "pro", subscriptionStatus: "canceled" }),
    });
    expect(nextId(lapsed)).toBe("upgrade");

    const paying = sold({
      ...base,
      shop: shop({ createdAt: ago(30 * DAY), plan: "pro", subscriptionStatus: "active" }),
    });
    expect(nextId(paying)).toBeNull();

    // A comp from /hq outranks whatever Stripe says, here as everywhere.
    const comped = sold({
      ...base,
      shop: shop({ createdAt: ago(30 * DAY), compPlan: "business" }),
    });
    expect(nextId(comped)).toBeNull();
  });
});

describe("the fleet that predates the pipeline", () => {
  /** Signed up months ago, built a shop, stopped. Every rung is stale. */
  const dormant = state({
    signedUpAt: ago(120 * DAY),
    shop: shop({ createdAt: ago(118 * DAY) }),
    productCount: 0,
  });

  it("gets the last-chance rung rather than the stale ones", () => {
    expect(nextId(dormant)).toBe("catch_up");
  });

  it("names where they actually stopped", () => {
    expect(lifecycleGap(dormant)).toBe("product");
    expect(lifecycleGap(state({ signedUpAt: ago(120 * DAY) }))).toBe("shop");
    expect(
      lifecycleGap({ ...dormant, productCount: 2, firstProductAt: ago(100 * DAY) }),
    ).toBe("rail");
    expect(
      lifecycleGap({
        ...dormant,
        productCount: 2,
        firstProductAt: ago(100 * DAY),
        railCount: 1,
      }),
    ).toBe("orders");
  });

  it("only ever fires once, and never after the ladder has spoken", () => {
    const mailed = { ...dormant, sent: new Set(["no_shop_1"]) };
    expect(nextId(mailed)).toBeNull();
  });

  it("lets a returning seller rejoin at the top of the shop branch", () => {
    // Caught up, then came back and built a shop. The fresh anchor is what
    // makes `shop_live` reachable again rather than the tombstone.
    const returned = {
      ...dormant,
      sent: new Set(["catch_up"]),
      shop: shop({ createdAt: ago(HOUR) }),
    };
    expect(nextId(returned)).toBe("shop_live");
  });
});

describe("retirement", () => {
  it("does not retire an account that is simply early", () => {
    // Signed up an hour ago: nothing is due yet, and tombstoning them here
    // would drop them out of the pipeline on day one.
    const fresh = state({ signedUpAt: ago(HOUR) });
    expect(nextId(fresh)).toBeNull();
    expect(isRetirable(fresh, NOW)).toBe(false);
  });

  it("retires an account every rung has gone stale for", () => {
    // Selling for months, never mailed, so `catch_up` does not apply either.
    const settled = state({
      signedUpAt: ago(150 * DAY),
      shop: shop({ createdAt: ago(148 * DAY) }),
      productCount: 5,
      firstProductAt: ago(147 * DAY),
      railCount: 2,
      orderCount: 40,
      firstOrderAt: ago(140 * DAY),
    });
    expect(nextId(settled)).toBeNull();
    expect(isRetirable(settled, NOW)).toBe(true);
  });

  it("never retires somebody who still has a rung due", () => {
    expect(isRetirable(state({ signedUpAt: ago(3 * HOUR) }), NOW)).toBe(false);
  });

  it("never retires an account the pipeline has already written to", () => {
    const spoken = state({
      signedUpAt: ago(150 * DAY),
      sent: new Set(["catch_up"]),
    });
    expect(isRetirable(spoken, NOW)).toBe(false);
  });
});

describe("one rung at a time", () => {
  it("tells the story in order when two rungs are due at once", () => {
    /*
     * A shop two and a half days old and still empty satisfies `shop_live`
     * (due at +20 minutes, stale at three days) and `no_product_1` (due at
     * two days) simultaneously. Ladder order is what decides that the link
     * arrives before the nag, and pacing is what puts a day between them.
     */
    let sent = new Set<string>();
    const seller = () =>
      state({
        signedUpAt: ago(3 * DAY),
        shop: shop({ createdAt: ago(2.5 * DAY) }),
        sent,
      });

    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const step = nextLifecycleStep(seller(), NOW);
      if (!step) break;
      order.push(step.id);
      sent = new Set([...sent, step.id]);
    }

    expect(order).toEqual(["shop_live", "no_product_1"]);
  });

  it("hands back a real rung for every id it names", () => {
    for (const id of LIFECYCLE_STEP_IDS) {
      expect(lifecycleStep(id).id).toBe(id);
    }
  });
});
