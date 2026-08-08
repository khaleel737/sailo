import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What a ceiling is allowed to say when it fires.
 *
 * Both limits added for the enumeration oracles shipped with the same bug, in
 * two different shapes: a throttled request was reported as a *negative
 * answer* rather than as no answer. "We did not check" and "we checked and the
 * answer is no" are different claims, and collapsing them puts the cost of a
 * limit on the person least able to have caused it — the buyer whose coupon
 * was silently dropped from a checkout they were part-way through, and the
 * seller behind a shared address told a free handle was taken.
 *
 * Both are shape assertions, in the idiom `orders.test.ts` uses, because the
 * property is about which branch the code takes and no unit test of either
 * function's return value can see it without Redis and a database.
 */

const preview = readFileSync("src/lib/actions/order-preview.ts", "utf8");
const shop = readFileSync("src/lib/actions/shop.ts", "utf8");
const field = readFileSync("src/components/shared/handle-field.tsx", "utf8");

describe("a coupon budget is spent on misses, not on lookups", () => {
  it("peeks before the lookup rather than consuming", () => {
    // Consuming here is what broke it: the code stays in the basket, so it is
    // re-checked on every keystroke and the ten were gone in seconds.
    expect(preview).toContain("const budget = await rateLimitPeek(guessKey, 10, 300)");
  });

  it("charges only when the code did not resolve", () => {
    expect(preview).toContain("if (budget.allowed && !found) await rateLimit(guessKey, 10, 300)");
  });

  it("does not charge on the path where the code was found", () => {
    // A valid code must be re-quotable forever. If a bare `await rateLimit(`
    // ever reappears against the guess key outside the miss branch, this is
    // the test that should stop it.
    const charges = preview.match(/await rateLimit\(guessKey/g) ?? [];
    expect(charges).toHaveLength(1);
  });
});

describe("a throttled handle check is unknown, not taken", () => {
  it("says so explicitly rather than returning a bare negative", () => {
    expect(shop).toContain("unknown: true");
  });

  it("draws an unknown result as neither available nor taken", () => {
    expect(field).toContain('fresh.unknown\n                ? { kind: "unknown" }');
  });

  it("lets onboarding continue when the check never ran", () => {
    // Blocking asserts something we did not learn, and strands anyone on a
    // shared address. Shop creation is the check that actually decides.
    expect(field).toContain('state.kind === "unknown"');
    const usable = /const usable =([\s\S]*?);/.exec(field)?.[1] ?? "";
    expect(usable).toContain('state.kind === "unknown"');
  });
});
