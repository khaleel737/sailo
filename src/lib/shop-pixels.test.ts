import { describe, expect, it } from "vitest";
import {
  configuredPixels,
  hasPixels,
  normalizePixelId,
  pixelIdsOf,
  readPixelIds,
  type ShopPixelColumns,
} from "./shop-pixels";

/**
 * These shapes are the injection defence for every seller-configured tag: an
 * id that passes goes into a script the storefront serves to buyers. Every
 * case in the refusal block is "does this get to run?", and the answer has to
 * be no for anything that is not plainly an id.
 */

const none: ShopPixelColumns = {
  ga4MeasurementId: null,
  gtmContainerId: null,
  metaPixelId: null,
  tiktokPixelId: null,
};

describe("what counts as an id", () => {
  it("the documented shapes, as issued", () => {
    expect(normalizePixelId("ga4", "G-ABC12DE3F4")).toEqual({ ok: true, id: "G-ABC12DE3F4" });
    expect(normalizePixelId("gtm", "GTM-AB12CD")).toEqual({ ok: true, id: "GTM-AB12CD" });
    expect(normalizePixelId("meta", "123456789012345")).toEqual({ ok: true, id: "123456789012345" });
    expect(normalizePixelId("tiktok", "C1AB23CD45EF67GH89IJ")).toEqual({ ok: true, id: "C1AB23CD45EF67GH89IJ" });
  });

  it("any case and stray whitespace — sellers paste, they don't type", () => {
    expect(normalizePixelId("ga4", "  g-abc12de3f4 ")).toEqual({ ok: true, id: "G-ABC12DE3F4" });
    expect(normalizePixelId("gtm", "gtm-ab12cd")).toEqual({ ok: true, id: "GTM-AB12CD" });
  });

  it("empty means cleared, not invalid — removing a pixel is a normal edit", () => {
    expect(normalizePixelId("ga4", "")).toEqual({ ok: true, id: null });
    expect(normalizePixelId("meta", "   ")).toEqual({ ok: true, id: null });
    expect(normalizePixelId("tiktok", null)).toEqual({ ok: true, id: null });
  });
});

describe("what is refused", () => {
  it("markup, quotes, and anything that could leave the id position", () => {
    for (const hostile of [
      "G-ABC\"><script>alert(1)</script>",
      "G-ABC'; fbq('init','x')",
      "GTM-AB12</script>",
      "javascript:alert(1)",
    ]) {
      expect(normalizePixelId("ga4", hostile).ok).toBe(false);
      expect(normalizePixelId("gtm", hostile).ok).toBe(false);
      expect(normalizePixelId("meta", hostile).ok).toBe(false);
      expect(normalizePixelId("tiktok", hostile).ok).toBe(false);
    }
  });

  it("the wrong provider's shape — a UA property is not a GA4 measurement id", () => {
    expect(normalizePixelId("ga4", "UA-12345-6").ok).toBe(false);
    expect(normalizePixelId("meta", "GTM-AB12CD").ok).toBe(false);
  });

  it("a pasted snippet rather than an id", () => {
    const snippet = "<script>fbq('init', '123456789012345');</script>";
    expect(normalizePixelId("meta", snippet).ok).toBe(false);
  });
});

describe("reading the settings form", () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(entries)) data.append(k, v);
    return data;
  };

  it("valid ids land in their columns; blanks clear them", () => {
    const read = readPixelIds(form({ pixelGa4: "g-abc12de3f4", pixelMeta: "" }));
    expect(read).toEqual({
      ok: true,
      columns: {
        ga4MeasurementId: "G-ABC12DE3F4",
        gtmContainerId: null,
        metaPixelId: null,
        tiktokPixelId: null,
      },
    });
  });

  it("a malformed paste refuses the save and names the format", () => {
    const read = readPixelIds(form({ pixelMeta: "not-a-pixel" }));
    expect(read.ok).toBe(false);
    if (!read.ok) {
      // The error must teach: the tool, and what a real id looks like.
      expect(read.error).toContain("Meta Pixel");
      expect(read.error).toContain("123456789012345");
    }
  });
});

describe("reading the shop row back", () => {
  it("a stored value that stopped looking like an id is treated as absent", () => {
    // Text columns hand back whatever was written, including by an older
    // build — and what they feed is a script tag.
    const ids = pixelIdsOf({
      ...none,
      ga4MeasurementId: "<script>x</script>",
      metaPixelId: "123456789012345",
    });
    expect(ids.ga4).toBeNull();
    expect(ids.meta).toBe("123456789012345");
  });

  it("no pixels means no banner and no tags", () => {
    expect(hasPixels(none)).toBe(false);
    expect(configuredPixels(pixelIdsOf(none))).toEqual([]);
  });

  it("one pixel is enough to have to ask", () => {
    expect(hasPixels({ ...none, tiktokPixelId: "C1AB23CD45EF67GH89IJ" })).toBe(true);
  });
});
