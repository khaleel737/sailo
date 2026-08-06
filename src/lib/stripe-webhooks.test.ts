import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { intentIdOf, sameAccount, sendingAccount } from "@/lib/stripe-webhooks";

/**
 * Who a webhook event is allowed to act on.
 *
 * Every seller on Sailo controls their own Stripe account, so anything an
 * event *says* about an order is a claim by that seller, not a fact. The only
 * thing that makes it a fact is the order's shop being the account the event
 * was signed by. `orderForSession` learned this the hard way; `charge.refunded`
 * never did, and looked its order up by payment intent alone.
 */

describe("sameAccount", () => {
  it("lets an account act on its own shop's order", () => {
    expect(sameAccount("acct_seller", "acct_seller")).toBe(true);
  });

  it("stops one seller acting on another's order", () => {
    // The bug: a seller with a connected account they control, sending an
    // event naming a victim's order.
    expect(sameAccount("acct_victim", "acct_attacker")).toBe(false);
  });

  it("denies when the shop has no connected account", () => {
    // No account means no charges, so no event can legitimately be about it.
    expect(sameAccount(null, "acct_attacker")).toBe(false);
  });

  it("denies when the sender cannot be identified", () => {
    // An unidentifiable sender has proved nothing. Denying is the only safe
    // reading — the alternative is "unknown means allowed".
    expect(sameAccount("acct_seller", null)).toBe(false);
  });

  it("denies when both are unknown, rather than matching null to null", () => {
    expect(sameAccount(null, null)).toBe(false);
  });
});

describe("sendingAccount", () => {
  const platform = process.env.STRIPE_PLATFORM_ACCOUNT_ID;
  afterEach(() => {
    if (platform === undefined) delete process.env.STRIPE_PLATFORM_ACCOUNT_ID;
    else process.env.STRIPE_PLATFORM_ACCOUNT_ID = platform;
  });

  it("uses the account the event named", () => {
    process.env.STRIPE_PLATFORM_ACCOUNT_ID = "acct_platform";
    expect(sendingAccount("acct_seller")).toBe("acct_seller");
  });

  it("reads a missing account as the platform's own", () => {
    /*
     * `actingAs` in lib/connect.ts drops the `stripeAccount` header when a shop
     * is wired to the platform's own account, so that shop's events arrive with
     * no account named. Without this fallback it would be the one shop nobody
     * could be scoped against.
     */
    process.env.STRIPE_PLATFORM_ACCOUNT_ID = "acct_platform";
    expect(sendingAccount(null)).toBe("acct_platform");
  });

  it("stays null when no platform account is configured", () => {
    // Which `sameAccount` then denies, rather than treating as a wildcard.
    delete process.env.STRIPE_PLATFORM_ACCOUNT_ID;
    expect(sendingAccount(null)).toBeNull();
    expect(sameAccount("acct_seller", sendingAccount(null))).toBe(false);
  });
});

describe("intentIdOf", () => {
  it("takes the id straight when Stripe sent a string", () => {
    expect(intentIdOf("pi_123")).toBe("pi_123");
  });

  it("reaches into an expanded intent", () => {
    expect(intentIdOf({ id: "pi_123" })).toBe("pi_123");
  });

  it.each([null, undefined])("has no id for %s", (value) => {
    expect(intentIdOf(value)).toBeNull();
  });
});

/**
 * The structural half of the fix.
 *
 * The pure rules above cannot catch the actual bug, which was a handler not
 * *calling* them: `charge.refunded` ran its own `findFirst` on
 * `stripePaymentIntentId` and acted on whatever came back. This asserts that
 * searching on that column happens in exactly one place — `orderForIntent`,
 * which scopes — so a new handler cannot quietly go direct again.
 */
describe("payment intent lookups", () => {
  const source = readFileSync("src/lib/stripe-webhooks.ts", "utf8");

  it("searches on stripePaymentIntentId in exactly one place", () => {
    const lookups = source.match(/eq\(orders\.stripePaymentIntentId/g) ?? [];
    expect(lookups).toHaveLength(1);
  });

  it("keeps that one lookup inside orderForIntent", () => {
    const body = source.slice(
      source.indexOf("export async function orderForIntent"),
    );
    const end = body.indexOf("\n}\n");
    expect(body.slice(0, end)).toContain("eq(orders.stripePaymentIntentId");
  });
});
