import { describe, expect, it } from "vitest";
import { KINDS, readGroupOptions, readRowOptions, readStock } from "./product-rows";

describe("readStock", () => {
  it.each([
    ["10", 10],
    ["0", 0],
    ["  7 ", 7],
  ])("reads %s as %i", (given, expected) => {
    expect(readStock(given)).toBe(expected);
  });

  it.each([[""], ["   "], ["lots"], ["N/A"]])(
    "returns null for %s, meaning nobody is counting",
    (given) => {
      // Null and zero are different answers: one is "untracked", the other is
      // "sold out". Reading a blank as zero would take a shop's stock offline.
      expect(readStock(given)).toBeNull();
    },
  );

  it("never returns a negative", () => {
    expect(readStock("-5")).toBeGreaterThanOrEqual(0);
  });
});

describe("readRowOptions", () => {
  it("reads a Shopify option triple", () => {
    expect(
      readRowOptions({
        "Option1 Name": "Size",
        "Option1 Value": "Large",
        "Option2 Name": "Colour",
        "Option2 Value": "Blue",
      }),
    ).toEqual([
      { name: "Size", value: "Large" },
      { name: "Colour", value: "Blue" },
    ]);
  });

  it("ignores an option with a name but no value", () => {
    expect(readRowOptions({ "Option1 Name": "Size", "Option1 Value": "" })).toEqual([]);
  });

  it("names an unnamed axis rather than dropping its value", () => {
    expect(readRowOptions({ "Option1 Value": "Large" })).toEqual([
      { name: "Option 1", value: "Large" },
    ]);
  });

  it("is empty for a product with no options", () => {
    expect(readRowOptions({ Title: "Mug" })).toEqual([]);
  });
});

describe("readGroupOptions", () => {
  it("collects every value seen across a handle's rows", () => {
    // Shopify writes one row per variant, repeating the product on each, so
    // the axes only exist once the group is read together.
    const rows = [
      { line: 2, raw: { "Option1 Name": "Size", "Option1 Value": "Small" } },
      { line: 3, raw: { "Option1 Name": "Size", "Option1 Value": "Large" } },
    ];
    const options = readGroupOptions(rows as never);
    expect(options).toHaveLength(1);
    expect(options[0]?.name).toBe("Size");
    expect(options[0]?.values).toEqual(["Small", "Large"]);
  });

  it("does not repeat a value that appears twice", () => {
    const rows = [
      { line: 2, raw: { "Option1 Name": "Size", "Option1 Value": "Small" } },
      { line: 3, raw: { "Option1 Name": "Size", "Option1 Value": "Small" } },
    ];
    expect(readGroupOptions(rows as never)[0]?.values).toEqual(["Small"]);
  });

  it("is empty for rows with no options", () => {
    expect(readGroupOptions([{ line: 2, raw: { Title: "Mug" } }] as never)).toEqual([]);
  });
});

describe("KINDS", () => {
  it("accepts only what a shop can sell", () => {
    expect([...KINDS].sort()).toEqual(["digital", "physical", "service"]);
  });
});
