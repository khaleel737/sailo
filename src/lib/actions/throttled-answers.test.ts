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

describe("a coupon budget is charged up front and refunded on a hit", () => {
  it("charges before the lookup rather than peeking", () => {
    /*
     * Both orderings have failed here, in opposite directions, so the exact
     * shape is the thing under test. Consuming without a refund burned the
     * honest buyer's budget on re-quotes. Peeking and charging on a miss let
     * a concurrent burst of guesses all read the counter before any wrote it,
     * which is a hole exactly where the ceiling aims. Charge-then-refund is
     * the only shape that closes both: the verdict is atomic in `INCR`, and a
     * real code hands its unit straight back.
     */
    expect(preview).toContain("const budget = await rateLimit(guessKey, 10, 300)");
    expect(preview).not.toContain("rateLimitPeek");
  });

  it("refunds exactly when the code resolved", () => {
    expect(preview).toContain("if (found) await refundRateLimit(guessKey, 300)");
  });

  it("gates the lookup on the verdict the charge returned", () => {
    // The atomicity only holds if the answer used is the one INCR gave back —
    // re-reading the counter here would reopen the burst window.
    expect(preview).toContain("const found = budget.allowed");
  });
});

describe("a throttled handle check is unknown, not taken", () => {
  it("answers with a verdict union, so a contradiction cannot be built", () => {
    /*
     * The first fix kept `available: boolean` and added an optional `unknown`
     * flag — which permits `{ available: true, unknown: true }`, a value
     * claiming both that the handle is free and that nobody checked. The type
     * now has one field with three cases, and the throttled branch returns
     * the one that tells the truth.
     */
    expect(shop).toContain('| { handle: string; verdict: "unknown" }');
    expect(shop).toContain('return { handle: raw, verdict: "unknown" };');
    // The declaration itself, not the file — the comment above it names the
    // old shape as a warning, which is exactly where the string should stay.
    const decl = /export type HandleStatus =([\s\S]*?);\n/.exec(shop)?.[1] ?? "";
    expect(decl).not.toContain("available: boolean");
    expect(decl).not.toContain("unknown?:");
  });

  it("lets onboarding continue when the check never ran", () => {
    // Blocking asserts something we did not learn, and strands anyone on a
    // shared address. Shop creation is the check that actually decides.
    const usable = /const usable =([\s\S]*?);/.exec(field)?.[1] ?? "";
    expect(usable).toContain('state.kind === "unknown"');
  });
});
