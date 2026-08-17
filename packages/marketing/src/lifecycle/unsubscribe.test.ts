import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unsubscribeToken } from "../broadcasts/unsubscribe";
import {
  marketingOptOutPostUrl,
  marketingOptOutToken,
  marketingOptOutUrl,
  readMarketingOptOutToken,
} from "./unsubscribe";

/**
 * The link that has to work.
 *
 * Every one of these assertions is about a promise rather than a function.
 * An unsubscribe link that has stopped working is not a broken feature, it is
 * a compliance failure and a spam complaint — so what is tested is that the
 * link survives the things that actually happen to it: being sent through a
 * URL, being clicked twice, being fed to the wrong reader, and being tampered
 * with by somebody who would like to unsubscribe a stranger.
 */

const SECRET = "test-secret-for-lifecycle-unsubscribe-tokens";

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.BETTER_AUTH_SECRET;
});

/**
 * A signed token, or a failed assertion. Every call site below has a secret
 * set, so a null here is the test's own setup breaking rather than something
 * for each case to re-check.
 */
function signed(email: string): string {
  const token = marketingOptOutToken({ email });
  expect(token).not.toBeNull();
  return token ?? "";
}

describe("marketing opt-out tokens", () => {
  it("round-trips the address it was given", () => {
    expect(readMarketingOptOutToken(signed("seller@example.com"))).toEqual({
      email: "seller@example.com",
    });
  });

  it("survives a trip through a URL", () => {
    // The whole path a real link takes: signed, encoded into an href, parsed
    // back out by the router, and read. A `+` or `/` in the base64 would have
    // died here, which is why the encoding is base64url.
    const token = signed("a+b/c@example.com");
    const url = new URL(marketingOptOutUrl(token, "https://sailo.store"));
    const last = url.pathname.split("/").at(-1) ?? "";
    const fromRouter = decodeURIComponent(last);

    expect(readMarketingOptOutToken(fromRouter)).toEqual({
      email: "a+b/c@example.com",
    });
  });

  it("is stable, so the same link keeps working months later", () => {
    // Nothing in the token expires and nothing is stored, which is the point:
    // the email being unsubscribed from may be eight months old and its
    // delivery rows long since tidied away.
    const first = marketingOptOutToken({ email: "seller@example.com" });
    const second = marketingOptOutToken({ email: "seller@example.com" });
    expect(first).toBe(second);
  });

  it("refuses a payload somebody edited", () => {
    const token = signed("seller@example.com");
    const [payload, signature] = token.split(".");

    const forged = Buffer.from(
      JSON.stringify({ e: "victim@example.com" }),
      "utf8",
    ).toString("base64url");

    expect(readMarketingOptOutToken(`${forged}.${signature}`)).toBeNull();
    expect(readMarketingOptOutToken(`${payload}.${signature}x`)).toBeNull();
  });

  it("refuses junk without throwing", () => {
    // This feeds a public route that promises a 204 whatever it is given, so
    // every one of these must be a null and not an exception.
    for (const junk of ["", ".", "..", "nope", "a.b", "%", "é".repeat(43)]) {
      expect(() => readMarketingOptOutToken(junk)).not.toThrow();
      expect(readMarketingOptOutToken(junk)).toBeNull();
    }
  });

  it("refuses a multi-byte signature of the same character length", () => {
    /*
     * The exact shape that once turned the broadcast route's promised 204
     * into an uncaught 500: `timingSafeEqual` throws on a byte-length
     * mismatch, and 43 multi-byte characters are 43 chars but 86 bytes — so a
     * length check on the strings waves this through.
     */
    const token = signed("seller@example.com");
    const payload = token.slice(0, token.lastIndexOf("."));
    const wideSignature = "é".repeat(token.length - payload.length - 1);

    expect(() =>
      readMarketingOptOutToken(`${payload}.${wideSignature}`),
    ).not.toThrow();
    expect(readMarketingOptOutToken(`${payload}.${wideSignature}`)).toBeNull();
  });

  it("cannot be confused with a shop's broadcast token", () => {
    /*
     * The two flows sign with keys derived from the same secret under
     * different domains, and this is what that buys. A token from the shop
     * flow must not unsubscribe anybody from Sailo's own list — the promises
     * are different and so are the tables.
     */
    const shopToken = unsubscribeToken({
      shopId: "11111111-1111-1111-1111-111111111111",
      email: "seller@example.com",
    });
    expect(shopToken).not.toBeNull();

    expect(readMarketingOptOutToken(shopToken ?? "")).toBeNull();
  });

  it("refuses to sign when there is no secret", () => {
    // A hard stop for the caller, not something to work around: the send pass
    // refuses the whole tick rather than mailing a dead link.
    delete process.env.BETTER_AUTH_SECRET;
    expect(marketingOptOutToken({ email: "seller@example.com" })).toBeNull();
    expect(readMarketingOptOutToken("anything.at.all")).toBeNull();
  });
});

describe("where the links point", () => {
  it("sends the header at a POST route and the footer at a page", () => {
    // RFC 8058 requires the header's URI to accept a POST, and a GET must
    // never unsubscribe anybody — so these are deliberately two addresses.
    const token = signed("seller@example.com");
    const base = "https://sailo.store";

    expect(marketingOptOutPostUrl(token, base)).toBe(
      `${base}/api/unsubscribe/marketing/${encodeURIComponent(token)}`,
    );
    expect(marketingOptOutUrl(token, base)).toBe(
      `${base}/u/marketing/${encodeURIComponent(token)}`,
    );
  });
});
