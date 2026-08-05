import { describe, expect, it } from "vitest";
import {
  classifyVisit,
  countryFlag,
  countryName,
  hostLabel,
  normalizeHost,
  parseUserAgent,
  SOURCE_LABELS,
  TRAFFIC_SOURCES,
} from "@/lib/analytics";

const SHOP_URL = "https://sailo.store/clay";

describe("normalizeHost", () => {
  it.each([
    ["www.Example.COM", "example.com"],
    ["m.facebook.com", "facebook.com"],
    ["l.instagram.com", "instagram.com"],
    ["shop.example.com", "shop.example.com"],
  ])("normalises %s", (given, expected) => {
    expect(normalizeHost(given)).toBe(expected);
  });

  it("strips the port", () => {
    // The Host header carries one; a referrer's hostname never does. Without
    // this the self-referral check silently fails behind any dev port.
    expect(normalizeHost("localhost:3000")).toBe("localhost");
    expect(normalizeHost("sailo.store:443")).toBe("sailo.store");
  });
});

describe("classifyVisit", () => {
  it("calls a visit with no referrer direct", () => {
    const v = classifyVisit({ referrer: null, url: SHOP_URL });
    expect(v.source).toBe("direct");
    expect(v.referrerHost).toBeNull();
  });

  it.each([
    ["https://www.instagram.com/x", "social", "instagram.com"],
    ["https://l.instagram.com/?u=x", "social", "instagram.com"],
    ["https://t.co/abc", "social", "t.co"],
    ["https://www.tiktok.com/@x", "social", "tiktok.com"],
    ["https://www.google.co.uk/search?q=mugs", "search", "google.co.uk"],
    ["https://duckduckgo.com/", "search", "duckduckgo.com"],
    ["https://chatgpt.com/", "search", "chatgpt.com"],
    ["https://someblog.dev/post", "referral", "someblog.dev"],
  ])("classifies %s as %s", (referrer, source, host) => {
    const v = classifyVisit({ referrer, url: SHOP_URL });
    expect(v.source).toBe(source);
    expect(v.referrerHost).toBe(host);
  });

  it("treats a same-site click as direct, not a self-referral", () => {
    const v = classifyVisit({
      referrer: "https://sailo.store/clay",
      url: SHOP_URL,
      selfHost: "sailo.store",
    });
    expect(v.source).toBe("direct");
    expect(v.referrerHost).toBeNull();
  });

  it("matches the self host even when the header carries a port", () => {
    const v = classifyVisit({
      referrer: "http://localhost/clay",
      url: "http://localhost:3000/clay",
      selfHost: "localhost:3000",
    });
    expect(v.source).toBe("direct");
  });

  it("lets a UTM tag outrank the referrer", () => {
    const v = classifyVisit({
      referrer: "https://www.instagram.com/",
      url: `${SHOP_URL}?utm_source=ig&utm_medium=bio&utm_campaign=spring`,
    });
    expect(v.source).toBe("campaign");
    expect(v.utmSource).toBe("ig");
    expect(v.utmMedium).toBe("bio");
    expect(v.utmCampaign).toBe("spring");
    // Still recorded — the seller may want both views.
    expect(v.referrerHost).toBe("instagram.com");
  });

  it.each([
    ["not a url", "malformed"],
    ["javascript:alert(1)", "non-http"],
    ["", "empty"],
  ])("ignores a %s referrer (%s)", (referrer) => {
    const v = classifyVisit({ referrer, url: SHOP_URL });
    expect(v.referrerHost).toBeNull();
    expect(v.source).toBe("direct");
  });

  it("survives a malformed landing URL", () => {
    expect(() => classifyVisit({ referrer: null, url: "((((" })).not.toThrow();
  });

  it("caps a very long referrer", () => {
    const v = classifyVisit({
      referrer: `https://x.dev/${"a".repeat(900)}`,
      url: SHOP_URL,
    });
    expect(v.referrer?.length ?? 0).toBeLessThanOrEqual(500);
  });

  it("caps a very long UTM value", () => {
    const v = classifyVisit({
      referrer: null,
      url: `${SHOP_URL}?utm_campaign=${"c".repeat(400)}`,
    });
    expect(v.utmCampaign?.length ?? 0).toBeLessThanOrEqual(120);
  });

  it("only ever returns a known source", () => {
    const v = classifyVisit({ referrer: "https://odd.example", url: SHOP_URL });
    expect(TRAFFIC_SOURCES).toContain(v.source);
    expect(SOURCE_LABELS[v.source]).toBeTruthy();
  });
});

describe("hostLabel", () => {
  it.each([
    ["instagram.com", "Instagram"],
    ["t.co", "Twitter"],
    ["youtu.be", "YouTube"],
    ["someblog.dev", "Someblog"],
  ])("names %s", (host, label) => {
    expect(hostLabel(host)).toBe(label);
  });

  it("calls no host Direct", () => {
    expect(hostLabel(null)).toBe("Direct");
  });
});

describe("parseUserAgent", () => {
  it("reads an iPhone", () => {
    const ua = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    );
    expect(ua).toEqual({ device: "mobile", os: "iOS", browser: "Safari" });
  });

  it("reads an iPad as a tablet", () => {
    expect(parseUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0) Safari/604.1").device).toBe(
      "tablet",
    );
  });

  it("distinguishes an Android tablet from a phone", () => {
    // Android phones carry "Mobile"; tablets don't. It's the only signal.
    expect(
      parseUserAgent("Mozilla/5.0 (Linux; Android 13; SM-X200) Chrome/120").device,
    ).toBe("tablet");
    expect(
      parseUserAgent("Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Chrome/120")
        .device,
    ).toBe("mobile");
  });

  it("does not mistake Edge for Chrome", () => {
    // Edge's UA contains "Chrome"; order of checks is the whole test.
    const ua = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36 Edg/120.0",
    );
    expect(ua.browser).toBe("Edge");
    expect(ua.os).toBe("Windows");
  });

  it("falls back to desktop with no UA", () => {
    expect(parseUserAgent(null)).toEqual({
      device: "desktop",
      os: null,
      browser: null,
    });
  });
});

describe("country display", () => {
  it("turns a code into a flag", () => {
    expect(countryFlag("NG")).toBe("🇳🇬");
    expect(countryFlag("ng")).toBe("🇳🇬");
  });

  it.each([["XYZ"], [null], [""], ["1A"]])("shows a globe for %s", (code) => {
    expect(countryFlag(code)).toBe("🌍");
  });

  it("names a country", () => {
    expect(countryName("NG")).toBe("Nigeria");
  });

  it("names it in the reader's language", () => {
    // Cached per locale — one shared instance pinned every caller to whichever
    // locale asked first, so a French seller read English country names.
    expect(countryName("DE", "fr")).toBe("Allemagne");
    expect(countryName("DE", "en")).toBe("Germany");
    expect(countryName("DE", "fr")).toBe("Allemagne");
  });

  it("falls back to the code it was given", () => {
    // Without `fallback: "code"` this reads "Unknown Region", which a seller
    // takes for a bug rather than for a country we couldn't place.
    expect(countryName("QQ")).toBe("QQ");
    expect(countryName(null)).toBe("Unknown");
  });

  it("still names ZZ, which CLDR really does define", () => {
    expect(countryName("ZZ")).toBe("Unknown Region");
  });
});
