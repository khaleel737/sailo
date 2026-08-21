import { describe, expect, it } from "vitest";
import {
  classifyVisit,
  hostLabel,
  looksLikeBot,
  normalizeHost,
  outboundHost,
  parseUserAgent,
} from "./traffic";
import { countryFlag, countryName } from "@sailo/core/countries";

/**
 * Where a visitor came from.
 *
 * A seller reads this to decide where to spend their time, so the cost of
 * getting it wrong is not a broken page — it is a shop owner concluding that
 * Instagram does nothing for them because half those visits were filed under
 * "Direct".
 */

describe("normalizeHost", () => {
  it("folds the prefixes that are the same site", () => {
    // m.facebook.com and www.facebook.com are one referrer, not three.
    expect(normalizeHost("www.facebook.com")).toBe("facebook.com");
    expect(normalizeHost("m.facebook.com")).toBe("facebook.com");
    expect(normalizeHost("l.facebook.com")).toBe("facebook.com");
  });

  it("drops the port, which is not part of the site", () => {
    expect(normalizeHost("example.com:3000")).toBe("example.com");
  });

  it("lowercases, because hosts are case-insensitive", () => {
    expect(normalizeHost("Example.COM")).toBe("example.com");
  });

  it("leaves a host that only looks like a prefix alone", () => {
    // "moby.com" starts with an m but is not a mobile subdomain.
    expect(normalizeHost("moby.com")).toBe("moby.com");
  });
});

describe("hostLabel", () => {
  it("calls an absent referrer Direct", () => {
    expect(hostLabel(null)).toBe("Direct");
  });

  it("names a brand it knows", () => {
    expect(hostLabel("instagram.com")).toBe("Instagram");
  });

  it("makes a readable word out of an unknown domain", () => {
    // The first label, capitalised — not a guess at a brand name, which would
    // read worse than the domain, and not the raw host with its TLD.
    expect(hostLabel("some-blog.example")).toBe("Some-blog");
  });
});

describe("classifyVisit", () => {
  it("files a visit with no referrer as direct", () => {
    expect(classifyVisit({}).source).toBe("direct");
  });

  it("does not count the shop's own pages as traffic", () => {
    /*
     * Someone moving between two pages of a shop is not a new arrival.
     * Counting it would inflate the number the seller trusts most.
     */
    const origin = classifyVisit({
      referrer: "https://sailo.store/mug",
      selfHost: "sailo.store",
    });
    expect(origin.source).toBe("direct");
  });

  it("reads the campaign a seller tagged their link with", () => {
    const origin = classifyVisit({
      url: "https://sailo.store/shop?utm_source=newsletter&utm_medium=email&utm_campaign=spring",
    });
    expect(origin.utmSource).toBe("newsletter");
    expect(origin.utmMedium).toBe("email");
    expect(origin.utmCampaign).toBe("spring");
  });

  it("survives a malformed URL rather than losing the visit", () => {
    // The URL arrives from the client. A throw here would drop the row.
    expect(() => classifyVisit({ url: "not a url", referrer: "also not" })).not.toThrow();
    expect(classifyVisit({ url: "not a url" }).source).toBe("direct");
  });

  it("ignores a referrer that is not a web page", () => {
    // javascript: and data: URLs are not somewhere a visitor came from.
    expect(classifyVisit({ referrer: "javascript:alert(1)" }).referrerHost).toBeNull();
  });

  it("caps what it stores, so one long value cannot fill the column", () => {
    const origin = classifyVisit({
      url: `https://sailo.store/s?utm_source=${"x".repeat(500)}`,
    });
    expect((origin.utmSource ?? "").length).toBeLessThanOrEqual(120);
  });
});

describe("outboundHost", () => {
  /*
   * The one function standing between a hostile beacon body and the
   * destinations chart. Everything that is not a real outbound web address
   * must come back null — a null is a dropped beacon, and dropping is the
   * safe direction.
   */
  it("keeps only the host of a real outbound URL", () => {
    expect(outboundHost("https://instagram.com/someshop?igsh=abc")).toBe(
      "instagram.com",
    );
  });

  it("refuses everything that is not http(s)", () => {
    expect(outboundHost("javascript:alert(1)")).toBeNull();
    expect(outboundHost("mailto:seller@example.com")).toBeNull();
    expect(outboundHost("tel:+4915112345678")).toBeNull();
    expect(outboundHost("data:text/html,hi")).toBeNull();
  });

  it("refuses a protocol-relative or malformed URL", () => {
    // "//evil.example" is not a URL without a base, and no base is given.
    expect(outboundHost("//evil.example/x")).toBeNull();
    expect(outboundHost("not a url")).toBeNull();
    expect(outboundHost("")).toBeNull();
    expect(outboundHost(42)).toBeNull();
    expect(outboundHost(null)).toBeNull();
  });

  it("stores the punycoded host as-is, however the link was written", () => {
    // One spelling per site: the parser punycodes unicode, and an already
    // punycoded host passes through unchanged.
    expect(outboundHost("https://münchen.de/laden")).toBe("xn--mnchen-3ya.de");
    expect(outboundHost("https://xn--mnchen-3ya.de/laden")).toBe(
      "xn--mnchen-3ya.de",
    );
  });

  it("does not count the shop's own storefront as outbound", () => {
    expect(outboundHost("https://sailo.store/mug", "sailo.store")).toBeNull();
    // The Host header carries a port; the URL's hostname never does.
    expect(
      outboundHost("http://localhost/checkout", "localhost:3000"),
    ).toBeNull();
  });

  it("groups the way referrer hosts group", () => {
    expect(outboundHost("https://www.YouTube.com/@shop")).toBe("youtube.com");
  });
});

describe("parseUserAgent", () => {
  it("survives a missing user agent", () => {
    expect(() => parseUserAgent(null)).not.toThrow();
    expect(() => parseUserAgent(undefined)).not.toThrow();
    expect(() => parseUserAgent("")).not.toThrow();
  });

  it("recognises a phone", () => {
    const info = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    );
    expect(info.device).toBe("mobile");
  });
});

describe("country display", () => {
  it("shows a globe rather than nothing for an unknown country", () => {
    // A blank cell in a table of flags reads as a rendering fault.
    expect(countryFlag(null)).toBe("🌍");
    expect(countryFlag("ZZ")).toBe("🌍");
  });

  it("builds a real flag from a country code", () => {
    expect(countryFlag("DE")).toBe("🇩🇪");
    expect(countryFlag("de")).toBe("🇩🇪");
  });

  it("names ZZ as unknown rather than inventing a country", () => {
    // ZZ is CLDR's real code for "Unknown Region" and arrives from GeoIP.
    expect(countryName("ZZ")).toBeTruthy();
    expect(countryName("ZZ")).not.toBe("ZZ");
  });

  it("falls back to the code itself for something it cannot name", () => {
    expect(countryName(null)).toBeTruthy();
  });
});

describe("looksLikeBot", () => {
  it("treats a missing user-agent as a bot — a browser's fetch always sends one", () => {
    expect(looksLikeBot(null)).toBe(true);
    expect(looksLikeBot(undefined)).toBe(true);
    expect(looksLikeBot("")).toBe(true);
  });

  it("catches declared crawlers, headless engines, monitors and HTTP libraries", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
      "Mozilla/5.0 (compatible; SemrushBot/7~bl)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/125.0.0.0 Safari/537.36",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "python-requests/2.31.0",
      "curl/8.4.0",
      "Go-http-client/2.0",
      "node-fetch/1.0",
      "axios/1.6.0",
      "Chrome-Lighthouse",
    ]) {
      expect(looksLikeBot(ua), ua).toBe(true);
    }
  });

  it("does not mistake a real browser for a bot", () => {
    for (const ua of [
      // Desktop Chrome, Safari, Firefox, Edge.
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
      // iPhone Safari, Android Chrome.
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      // The lookalikes the comment promises are safe: YaBrowser is not "yandex",
      // and Safari's "Version/" token is not an HTTP library.
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 YaBrowser/24.4 Safari/537.36",
    ]) {
      expect(looksLikeBot(ua), ua).toBe(false);
    }
  });
});
