import { describe, expect, it } from "vitest";
import { interpolate, plural } from "./interpolate";

/**
 * Placeholder substitution, which every counted phrase on every surface goes through.
 *
 * The decision worth pinning is what happens to a placeholder nobody supplied: it is
 * left exactly as written. That is right — a half-substituted string is more debuggable
 * than a silently empty one — and it is also why the dictionary test next door checks
 * that translations do not invent placeholder names. The two behaviours only make sense
 * together.
 */

describe("interpolate", () => {
  it("substitutes what it is given", () => {
    expect(interpolate("Hello {name}", { name: "Ada" })).toBe("Hello Ada");
  });

  it("substitutes a number without the caller stringifying it", () => {
    expect(interpolate("{count} left", { count: 3 })).toBe("3 left");
  });

  it("substitutes zero, which is a real count and not an absence", () => {
    expect(interpolate("{count} left", { count: 0 })).toBe("0 left");
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(interpolate("{a} and {a}", { a: "x" })).toBe("x and x");
  });

  it("handles more than one placeholder", () => {
    expect(interpolate("{a} of {b}", { a: 1, b: 10 })).toBe("1 of 10");
  });

  /*
   * Left as-is, on purpose. A missing value shows `{name}` on the screen — which is how
   * a renamed placeholder in a translation becomes visible at all, to whoever reads that
   * language. Substituting an empty string would hide it.
   */
  it("leaves an unknown placeholder alone", () => {
    expect(interpolate("Hello {name}", { other: "x" })).toBe("Hello {name}");
  });

  it("returns the template untouched when given no values at all", () => {
    expect(interpolate("Hello {name}")).toBe("Hello {name}");
    expect(interpolate("Hello")).toBe("Hello");
  });

  it("does not treat braces that are not placeholders as placeholders", () => {
    // `\w+` only, so CSS-ish or JSON-ish text in a string survives.
    expect(interpolate("{ }", { a: "x" })).toBe("{ }");
    expect(interpolate("{a-b}", { "a-b": "x" })).toBe("{a-b}");
  });

  it("does not re-scan what it just substituted", () => {
    // Otherwise a value containing a placeholder name would be expanded again, which is
    // how a translation file becomes a template injection.
    expect(interpolate("{a}", { a: "{b}", b: "boom" })).toBe("{b}");
  });
});

describe("plural", () => {
  it("uses the singular for exactly one", () => {
    expect(plural(1, "{count} item", "{count} items")).toBe("1 item");
  });

  it("uses the plural for none, which English does", () => {
    expect(plural(0, "{count} item", "{count} items")).toBe("0 items");
  });

  it("uses the plural for more than one", () => {
    expect(plural(7, "{count} item", "{count} items")).toBe("7 items");
  });

  it("supplies count without the caller repeating it", () => {
    expect(plural(2, "one", "{count} of them")).toBe("2 of them");
  });

  it("passes extra values through alongside the count", () => {
    expect(plural(2, "{name}: one", "{name}: {count}", { name: "Cart" })).toBe("Cart: 2");
  });

  /*
   * A caller's own `count` cannot override the real one — the spread puts `count` first
   * so `values` wins, which would let a caller print a different number from the one that
   * chose the form. Pinned so the spread order is not "tidied".
   */
  it("lets an explicit count value win, which is the current spread order", () => {
    expect(plural(1, "{count} item", "{count} items", { count: 99 })).toBe("99 item");
  });

  it("treats a negative count as plural rather than throwing", () => {
    expect(plural(-1, "{count} item", "{count} items")).toBe("-1 items");
  });
});
