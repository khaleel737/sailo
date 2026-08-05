import { describe, expect, it } from "vitest";
import { clean } from "./sanitize";

describe("clean", () => {
  it("trims surrounding whitespace", () => {
    expect(clean("  Ada Lovelace  ", 80)).toBe("Ada Lovelace");
  });

  it("caps at the given length", () => {
    expect(clean("a".repeat(200), 10)).toHaveLength(10);
  });

  it.each([[undefined], [""], ["   "], ["\n\t"]])("returns null for %s", (value) => {
    // Null rather than "" so a blank field stays distinguishable from an
    // answer of empty — the difference between "no phone" and "phone: ".
    expect(clean(value as string | undefined, 80)).toBeNull();
  });

  it("keeps everything inside the cap", () => {
    expect(clean("Speckled mug", 80)).toBe("Speckled mug");
  });
});
