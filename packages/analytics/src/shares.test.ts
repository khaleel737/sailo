import { describe, expect, it } from "vitest";
import {
  SHARE_MAX_DAYS,
  SHARE_METRICS,
  shareExpiry,
  shareScope,
  shareState,
} from "./shares";

/**
 * The rules that make a public revenue link safe.
 *
 * Each of these is one of the spec's non-negotiables, and each is here because
 * relaxing it turns a useful feature into a leak: an expiry that is optional,
 * a scope that is a query parameter, a revocation that lapses.
 */

const NOW = new Date("2026-08-19T12:00:00Z");

describe("the scope is on the row, never in the URL", () => {
  it("reads one metric and one range back", () => {
    expect(shareScope({ metric: "revenue", range: "30d" })).toEqual({
      metric: "revenue",
      range: "30d",
    });
  });

  it("refuses a row this build does not understand", () => {
    /*
     * Not hypothetical: a newer deploy could add a metric, and this build
     * rendering "whatever that means" would be a public page guessing at what
     * it is allowed to show.
     */
    expect(shareScope({ metric: "everything", range: "30d" })).toBeNull();
    expect(shareScope({ metric: "revenue", range: "forever" })).toBeNull();
  });

  it("has no metric that means a dashboard", () => {
    // A token that rendered a dashboard is a token whose scope grows every
    // time somebody adds a tile to it.
    expect(SHARE_METRICS).not.toContain("dashboard");
    expect(SHARE_METRICS).not.toContain("all");
  });
});

describe("the expiry is required and capped", () => {
  it("defaults to thirty days", () => {
    const result = shareExpiry(undefined, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiresAt.getTime() - NOW.getTime()).toBe(30 * 86_400_000);
  });

  it("refuses longer than the maximum rather than clamping", () => {
    /*
     * The one place this codebase does not clamp-and-say-so. A seller who
     * typed 365 and silently got 90 has a link they believe covers the year,
     * and they will not look again — being told 90 is the maximum is the whole
     * point of the cap.
     */
    expect(shareExpiry(SHARE_MAX_DAYS + 1, NOW)).toEqual({
      ok: false,
      problem: "tooLong",
    });
    expect(shareExpiry(365, NOW)).toEqual({ ok: false, problem: "tooLong" });
  });

  it("refuses zero, negative and fractional", () => {
    for (const days of [0, -1, 1.5]) {
      expect(shareExpiry(days, NOW), String(days)).toEqual({
        ok: false,
        problem: "tooShort",
      });
    }
  });

  it("takes the maximum itself", () => {
    expect(shareExpiry(SHARE_MAX_DAYS, NOW).ok).toBe(true);
  });
});

describe("what state a link is in", () => {
  const future = new Date(NOW.getTime() + 86_400_000);
  const past = new Date(NOW.getTime() - 86_400_000);

  it("is live until it expires", () => {
    expect(shareState({ expiresAt: future, revokedAt: null }, NOW)).toBe("live");
    expect(shareState({ expiresAt: past, revokedAt: null }, NOW)).toBe("expired");
  });

  it("is expired the instant it expires, not a moment after", () => {
    expect(shareState({ expiresAt: NOW, revokedAt: null }, NOW)).toBe("expired");
  });

  it("stays revoked even once the date passes", () => {
    /*
     * Revoked outranks expired because it is the answer the seller acted on.
     * A settings list that turned a revocation into an expiry would be telling
     * them their revocation had lapsed into something else.
     */
    expect(shareState({ expiresAt: past, revokedAt: past }, NOW)).toBe("revoked");
    expect(shareState({ expiresAt: future, revokedAt: past }, NOW)).toBe("revoked");
  });
});
