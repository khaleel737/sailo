import { describe, expect, it } from "vitest";
import type { ProductOption } from "@sailo/db/schema";
import {
  optionalCents,
  optionalCount,
  readImageUrls,
  readJson,
  readJsonRows,
  readTags,
  text,
  usableVariants,
} from "./form-fields";

/**
 * Every one of these is pure, and until now none could be reached: they sat
 * inside a `"use server"` file, which may only export async functions.
 *
 * The rule they share is blank versus zero. An empty field is "no answer" and
 * the variant inherits from its product; `0` is an answer meaning free, or
 * none left. Collapsing the two would price a variant at nothing.
 */

const form = (pairs: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of pairs) fd.append(k, v);
  return fd;
};

describe("optionalCents", () => {
  it("returns null for blank, so the variant inherits its product's price", () => {
    expect(optionalCents("")).toBeNull();
    expect(optionalCents("   ")).toBeNull();
    expect(optionalCents(undefined)).toBeNull();
  });

  it("returns 0 for a real zero, which means free", () => {
    expect(optionalCents("0")).toBe(0);
    expect(optionalCents("0.00")).toBe(0);
  });

  it("reads money as minor units", () => {
    expect(optionalCents("19.99")).toBe(1999);
  });
});

describe("optionalCount", () => {
  it("keeps blank and zero apart — untracked stock is not sold out", () => {
    expect(optionalCount("")).toBeNull();
    expect(optionalCount("0")).toBe(0);
  });

  it("refuses a negative count rather than storing one", () => {
    expect(optionalCount("-5")).toBe(0);
  });

  it("truncates rather than rounding, so 1.9 units is 1", () => {
    expect(optionalCount("1.9")).toBe(1);
  });

  it("caps at the ceiling", () => {
    expect(optionalCount("99999999", 1000)).toBe(1000);
  });

  it("returns null for something that isn't a number at all", () => {
    // Not 0 — that would silently mark the product sold out.
    expect(optionalCount("many")).toBeNull();
    expect(optionalCount("NaN")).toBeNull();
  });
});

describe("text", () => {
  it("treats whitespace as absent", () => {
    expect(text("   ", 10)).toBeNull();
    expect(text("", 10)).toBeNull();
  });

  it("trims and caps", () => {
    expect(text("  hello  ", 10)).toBe("hello");
    expect(text("abcdefghijkl", 5)).toBe("abcde");
  });
});

describe("readJson", () => {
  it("returns null rather than throwing on malformed input", () => {
    // One bad row must not take down the whole save.
    expect(readJson("{not json")).toBeNull();
    expect(readJson("")).toBeNull();
    expect(readJson(null)).toBeNull();
  });

  it("parses a row", () => {
    expect(readJson<{ sku: string }>('{"sku":"A1"}')).toEqual({ sku: "A1" });
  });
});

describe("readJsonRows", () => {
  it("drops unparseable rows and keeps the rest in order", () => {
    /*
     * One blob per row exists precisely so a bad row can be dropped on its
     * own. With parallel arrays, an unchecked box submits nothing and every
     * later value shifts onto the wrong variant.
     */
    const fd = form([
      ["variants", '{"sku":"A"}'],
      ["variants", "broken"],
      ["variants", '{"sku":"B"}'],
    ]);
    expect(readJsonRows<{ sku: string }>(fd, "variants")).toEqual([
      { sku: "A" },
      { sku: "B" },
    ]);
  });
});

describe("readTags and readImageUrls", () => {
  it("splits tags, trims them and drops blanks", () => {
    expect(readTags(form([["tags", "new, , sale ,"]]))).toEqual(["new", "sale"]);
  });

  it("caps tags at twelve", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`).join(",");
    expect(readTags(form([["tags", many]]))).toHaveLength(12);
  });

  it("caps images at eight and drops blanks", () => {
    const pairs: [string, string][] = Array.from({ length: 12 }, (_, i) => [
      "imageUrls",
      i === 0 ? "  " : `https://abc.public.blob.vercel-storage.com/${i}.jpg`,
    ]);
    const urls = readImageUrls(form(pairs));
    expect(urls).toHaveLength(8);
    expect(urls).not.toContain("");
  });

  it("drops an image URL the server must not fetch", () => {
    /*
     * A server action takes whatever the client sends — the upload widget in
     * front of this is a suggestion, not a constraint — and these end up in
     * `lib/og.tsx`'s `fetchImage`, which runs on a public unauthenticated
     * route. An unvalidated string here is a server-side request a seller
     * composes.
     */
    const urls = readImageUrls(
      form([
        ["imageUrls", "http://169.254.169.254/latest/meta-data/"],
        ["imageUrls", "http://10.0.0.5:8080/"],
        ["imageUrls", "https://evil.tld/a.png"],
        ["imageUrls", "https://abc.public.blob.vercel-storage.com/ok.jpg"],
      ]),
    );
    expect(urls).toEqual(["https://abc.public.blob.vercel-storage.com/ok.jpg"]);
  });
});

describe("usableVariants", () => {
  const options: ProductOption[] = [{ name: "Size", values: ["S", "M"] }];

  it("has nothing to keep when the product has no options", () => {
    expect(usableVariants([], [{ options: { Size: "S" } }])).toEqual([]);
  });

  it("drops a combination the options no longer describe", () => {
    // The orphan an option rename leaves behind — a row no buyer can select.
    const kept = usableVariants(options, [
      { options: { Size: "S" } },
      { options: { Size: "XL" } },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.options).toEqual({ Size: "S" });
  });

  it("keeps only the first row for a repeated combination", () => {
    const kept = usableVariants(options, [
      { options: { Size: "S" }, sku: "first" },
      { options: { Size: "S" }, sku: "second" },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.sku).toBe("first");
  });

  it("ignores a row with no options at all", () => {
    expect(usableVariants(options, [{ sku: "orphan" }])).toEqual([]);
  });
});
