import { describe, expect, it } from "vitest";
import {
  MAX_TAGS,
  normalizeTag,
  normalizeTags,
  tagVocabulary,
  tagsToCsv,
} from "./client-tags";

describe("normalizeTag", () => {
  it("folds case, because a filter is an equality test", () => {
    // "VIP" in January and "vip" in March are one audience, and a broadcast
    // that reaches a third of the people the seller meant is the bug.
    expect(normalizeTag("VIP")).toBe("vip");
    expect(normalizeTag("  Vip  ")).toBe("vip");
  });

  it("collapses inner whitespace to single hyphens", () => {
    expect(normalizeTag("march workshop")).toBe("march-workshop");
    expect(normalizeTag("march   workshop")).toBe("march-workshop");
  });

  it("strips the characters that are separators elsewhere", () => {
    // The CSV writer joins on ";" and the input splits on "," — either
    // surviving inside a tag makes it round-trip as two.
    expect(normalizeTag("a,b")).toBe("a-b");
    expect(normalizeTag("a;b")).toBe("a-b");
  });

  it("trims hyphens left at the edges", () => {
    expect(normalizeTag("-vip-")).toBe("vip");
    expect(normalizeTag(", vip ,")).toBe("vip");
  });

  it("cuts an over-long tag rather than refusing it", () => {
    const tag = normalizeTag("a".repeat(50));
    expect(tag).toBe("a".repeat(32));
  });

  it("does not leave a hyphen where the cut landed", () => {
    // 32 characters exactly, with the 32nd a space — the slice would end on
    // the hyphen it became.
    const tag = normalizeTag(`${"a".repeat(31)} bbb`);
    expect(tag).toBe("a".repeat(31));
  });

  it("answers null for what is not a tag", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag(",,,")).toBeNull();
    expect(normalizeTag(null)).toBeNull();
    expect(normalizeTag(42)).toBeNull();
  });
});

describe("normalizeTags", () => {
  it("reads an array from a form", () => {
    expect(normalizeTags(["VIP", "Wholesale"])).toEqual({
      tags: ["vip", "wholesale"],
      truncated: false,
    });
  });

  it("reads the separated string a CSV cell and a text input produce", () => {
    expect(normalizeTags("vip, wholesale;lapsed").tags).toEqual([
      "vip",
      "wholesale",
      "lapsed",
    ]);
  });

  it("deduplicates after folding, not before", () => {
    expect(normalizeTags(["VIP", "vip", " Vip "]).tags).toEqual(["vip"]);
  });

  it("keeps the seller's own order", () => {
    expect(normalizeTags(["zebra", "apple"]).tags).toEqual(["zebra", "apple"]);
  });

  it("says so when it truncates rather than dropping quietly", () => {
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `tag-${i}`);
    const result = normalizeTags(many);
    expect(result.tags).toHaveLength(MAX_TAGS);
    expect(result.truncated).toBe(true);
  });

  it("treats junk as an empty list", () => {
    expect(normalizeTags(undefined)).toEqual({ tags: [], truncated: false });
    expect(normalizeTags({})).toEqual({ tags: [], truncated: false });
  });
});

describe("round-tripping through a CSV", () => {
  it("reads back exactly what it wrote", () => {
    const tags = ["vip", "march-workshop", "wholesale"];
    expect(normalizeTags(tagsToCsv(tags)).tags).toEqual(tags);
  });
});

describe("tagVocabulary", () => {
  it("collects every tag in use, once, sorted", () => {
    expect(
      tagVocabulary([
        { tags: ["vip", "lapsed"] },
        { tags: ["vip"] },
        { tags: [] },
        { tags: ["apple"] },
      ]),
    ).toEqual(["apple", "lapsed", "vip"]);
  });
});
