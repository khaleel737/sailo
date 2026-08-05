import { describe, expect, it } from "vitest";
import { ipFromHeaders } from "./client-ip";

/**
 * The rate-limit key. Getting it wrong doesn't leak anything — this value
 * never gates access — but it decides whether the limiter throttles one
 * caller or a whole network at once.
 */

const h = (init: Record<string, string>) => new Headers(init);

describe("ipFromHeaders", () => {
  it("takes the client, not the proxy that forwarded it", () => {
    /*
     * Each hop appends, so the client is first. Taking the last would key
     * every request behind a CDN to the same bucket — one abusive caller
     * would then throttle everyone sharing that edge.
     */
    expect(ipFromHeaders(h({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" })))
      .toBe("203.0.113.7");
  });

  it("trims the spacing proxies leave behind", () => {
    expect(ipFromHeaders(h({ "x-forwarded-for": "  203.0.113.7 ,  70.41.3.18" })))
      .toBe("203.0.113.7");
  });

  it("handles a single address with no chain", () => {
    expect(ipFromHeaders(h({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(ipFromHeaders(h({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("prefers the forwarding chain when both are present", () => {
    expect(
      ipFromHeaders(
        h({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.4" }),
      ),
    ).toBe("203.0.113.7");
  });

  it("never returns empty, so the limiter always has a key", () => {
    // An empty key would collapse every anonymous caller into one bucket, or
    // worse, into no bucket at all.
    expect(ipFromHeaders(h({}))).toBe("unknown");
    expect(ipFromHeaders(h({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(ipFromHeaders(h({ "x-forwarded-for": "   " }))).toBe("unknown");
    expect(ipFromHeaders(h({ "x-forwarded-for": ",,," }))).toBe("unknown");
    expect(ipFromHeaders(h({ "x-real-ip": "  " }))).toBe("unknown");
  });

  it("keeps IPv6 intact", () => {
    expect(ipFromHeaders(h({ "x-forwarded-for": "2001:db8::1, 70.41.3.18" })))
      .toBe("2001:db8::1");
  });
});
