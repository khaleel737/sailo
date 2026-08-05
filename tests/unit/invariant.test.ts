import { describe, expect, it } from "vitest";
import { assertPresent, firstRow, InvariantError, present } from "@/lib/invariant";

describe("present", () => {
  it("returns the value when there is one", () => {
    expect(present("x", "a value")).toBe("x");
    expect(present(0, "zero")).toBe(0);
    expect(present(false, "false")).toBe(false);
  });

  it.each([[null], [undefined]])("throws for %s", (value) => {
    expect(() => present(value, "a shop")).toThrow(InvariantError);
  });

  it("names what was missing, so the log points at the cause", () => {
    // The whole reason this exists rather than `!`: a bare non-null assertion
    // fails three frames later as "cannot read properties of undefined".
    expect(() => present(null, "the seller's shop")).toThrow(/the seller's shop/);
  });
});

describe("assertPresent", () => {
  it("narrows the type for everything after it", () => {
    const maybe: string | null = "x" as string | null;
    assertPresent(maybe, "a string");
    expect(maybe.length).toBe(1);
  });
});

describe("firstRow", () => {
  it("returns the first row", () => {
    expect(firstRow([{ id: "a" }, { id: "b" }], "shops")).toEqual({ id: "a" });
  });

  it("throws when a write returned nothing", () => {
    // An empty `returning()` means the insert didn't happen — a conflict
    // clause that matched, or a `where` that found no rows.
    expect(() => firstRow([], "the inserted order")).toThrow(/the inserted order/);
  });

  it("throws InvariantError, not a generic Error", () => {
    expect(() => firstRow([], "x")).toThrow(InvariantError);
  });
});
