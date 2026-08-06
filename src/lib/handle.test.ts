import { describe, expect, it } from "vitest";
import {
  HANDLE_MAX,
  HANDLE_MESSAGES,
  HANDLE_MIN,
  normalizeHandle,
  RESERVED_HANDLES,
  suggestHandles,
  validateHandleFormat,
  type HandleProblem,
} from "@/lib/handle";

/**
 * What a shop is allowed to call itself.
 *
 * Handles sit at the root of the site, so this list is the only thing stopping
 * a shop from claiming `/admin`, `/api` or `/hq` and serving its own page where
 * the seller dashboard, the webhooks or Sailo's own back office should be.
 */

describe("normalizeHandle", () => {
  it("lowercases and trims", () => {
    expect(normalizeHandle("  MyShop  ")).toBe("myshop");
  });

  it("drops characters a URL segment should not carry", () => {
    expect(normalizeHandle("my shop!")).toBe("myshop");
    expect(normalizeHandle("café/../etc")).toBe("caf..etc".replace("..", ""));
  });

  it("keeps hyphens and underscores, which are legal inside a handle", () => {
    expect(normalizeHandle("my-shop_2")).toBe("my-shop_2");
  });

  it("cannot produce a path separator or a dot segment", () => {
    // The whole point: whatever is typed, the result is one flat segment.
    for (const hostile of ["../admin", "a/b", "a.b", "a%2Fb", "a?x=1", "a#b"]) {
      const out = normalizeHandle(hostile);
      expect(out).not.toMatch(/[/.%?#]/);
    }
  });

  it("truncates to the maximum length", () => {
    expect(normalizeHandle("a".repeat(100))).toHaveLength(HANDLE_MAX);
  });
});

describe("validateHandleFormat", () => {
  it("accepts an ordinary handle", () => {
    expect(validateHandleFormat("forno")).toBeNull();
    expect(validateHandleFormat("my-shop_2")).toBeNull();
  });

  it("rejects an empty field as empty, not as invalid", () => {
    // The two produce different messages, and "pick a link" is the useful one.
    expect(validateHandleFormat("")).toBe("empty");
    expect(validateHandleFormat("   ")).toBe("empty");
  });

  it("rejects a handle made entirely of illegal characters as invalid", () => {
    // They typed something; telling them it was empty would be a lie.
    expect(validateHandleFormat("!!!")).toBe("invalid_chars");
    expect(validateHandleFormat("日本語")).toBe("invalid_chars");
  });

  it("rejects a handle below the minimum", () => {
    expect(validateHandleFormat("ab")).toBe("too_short");
    expect(validateHandleFormat("a".repeat(HANDLE_MIN))).toBeNull();
  });

  it("rejects a too-long handle rather than silently truncating it", () => {
    /*
     * Measured before normalising. `normalizeHandle` truncates, so checking
     * the normalised value made this unreachable — a seller typing fifty
     * characters got thirty-two back with no explanation, and their link
     * quietly was not the one they asked for.
     */
    expect(validateHandleFormat("a".repeat(HANDLE_MAX + 1))).toBe("too_long");
    expect(validateHandleFormat("a".repeat(HANDLE_MAX))).toBeNull();
  });

  it("rejects a leading or trailing hyphen or underscore", () => {
    for (const bad of ["-shop", "shop-", "_shop", "shop_"]) {
      expect(validateHandleFormat(bad)).toBe("edge_dash");
    }
  });

  it.each(["admin", "api", "login", "checkout"])(
    "refuses to let a shop claim /%s",
    (reserved) => {
      expect(validateHandleFormat(reserved)).toBe("reserved");
    },
  );

  it("leaves no name on the reserved list claimable", () => {
    /*
     * Guards the list as a whole rather than a sample. The assertion is
     * "rejected", not "rejected as reserved", because the two rules overlap:
     * `hq` and `me` are shorter than HANDLE_MIN and are refused as `too_short`
     * without ever reaching the reserved branch. That still protects the
     * route, which is what matters — a test demanding the exact reason would
     * be asserting which guard fires first rather than that one does.
     */
    for (const reserved of RESERVED_HANDLES) {
      expect(validateHandleFormat(reserved)).not.toBeNull();
    }
  });

  it("protects the short reserved names by length instead", () => {
    // Named so the overlap above is deliberate rather than discovered again.
    expect(validateHandleFormat("hq")).toBe("too_short");
    expect("hq".length).toBeLessThan(HANDLE_MIN);
  });

  it("is not case sensitive about a reserved name", () => {
    // `/Admin` and `/admin` are the same route to claim.
    expect(validateHandleFormat("ADMIN")).toBe("reserved");
    expect(validateHandleFormat("  Admin  ")).toBe("reserved");
  });

  it("still allows a handle that merely contains a reserved word", () => {
    // Only an exact collision matters; `adminsupplies` shadows nothing.
    expect(validateHandleFormat("adminsupplies")).toBeNull();
    expect(validateHandleFormat("my-shop-blog")).toBeNull();
  });

  it("has a message for every problem it can report", () => {
    const problems: HandleProblem[] = [
      "empty",
      "too_short",
      "too_long",
      "invalid_chars",
      "edge_dash",
      "reserved",
      "taken",
    ];
    for (const problem of problems) {
      expect(HANDLE_MESSAGES[problem]).toBeTruthy();
    }
  });
});

describe("suggestHandles", () => {
  it("offers alternatives that are themselves valid", () => {
    /*
     * A suggestion the seller cannot accept is worse than none — they click it
     * and the form rejects what it just proposed.
     */
    const suggestions = suggestHandles("forno");
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(validateHandleFormat(suggestion)).toBeNull();
    }
  });

  it("never suggests a reserved name", () => {
    for (const suggestion of suggestHandles("shop")) {
      expect(RESERVED_HANDLES.has(suggestion)).toBe(false);
    }
  });

  it("keeps every suggestion within the length limit", () => {
    for (const suggestion of suggestHandles("a".repeat(HANDLE_MAX))) {
      expect(suggestion.length).toBeLessThanOrEqual(HANDLE_MAX);
    }
  });

  it("returns no duplicates", () => {
    const suggestions = suggestHandles("forno");
    expect(new Set(suggestions).size).toBe(suggestions.length);
  });

  it("has nothing to suggest when there is nothing to build on", () => {
    expect(suggestHandles("")).toEqual([]);
    expect(suggestHandles("!!!")).toEqual([]);
  });
});
