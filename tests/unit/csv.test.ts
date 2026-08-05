import { describe, expect, it } from "vitest";
import {
  bool,
  date,
  escapeField,
  field,
  money,
  parseBool,
  parseMoneyField,
  csvResponse,
  toCsv,
} from "@/lib/csv";

describe("escapeField", () => {
  it("quotes a field containing a comma", () => {
    expect(escapeField("Clay, Co")).toBe('"Clay, Co"');
  });

  it("doubles an embedded quote", () => {
    expect(escapeField('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(escapeField("line one\nline two")).toContain('"');
  });

  it.each([["=cmd|'/c calc'!A1"], ["+1+1"], ["-1+1"], ["@SUM(A1)"]])(
    "neutralises %s so a spreadsheet can't execute it",
    (payload) => {
      // Excel and Sheets run a cell starting with = + - or @. A seller
      // exporting their own orders should not be handing themselves a shell.
      const out = escapeField(payload);
      const inner = out.startsWith('"') ? out.slice(1) : out;
      expect(["=", "+", "-", "@"]).not.toContain(inner[0]);
    },
  );

  it("leaves an ordinary value alone", () => {
    expect(escapeField("Speckled mug")).toBe("Speckled mug");
  });

  it.each([[null], [undefined]])("renders %s as empty", (value) => {
    expect(escapeField(value)).toBe("");
  });
});

describe("toCsv", () => {
  it("writes a header row and the data", () => {
    const csv = toCsv(["Title", "Price"], [["Mug", "24.00"]]);
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe("Title,Price");
    expect(row).toBe("Mug,24.00");
  });

  it("escapes inside rows", () => {
    expect(toCsv(["Title"], [["Clay, Co"]])).toContain('"Clay, Co"');
  });

  it("ends with a newline for POSIX tools", () => {
    expect(toCsv(["Title"], [["Mug"]]).endsWith("\n")).toBe(true);
  });
});

describe("csvResponse", () => {
  it("prefixes a BOM so Excel reads UTF-8", () => {
    // Without it Excel mangles every accent and every non-Latin script.
    const res = csvResponse("orders.csv", "Title\nCafé\n");
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("orders.csv");
  });
});

describe("formatting", () => {
  it("writes money in major units", () => {
    expect(money(2_400)).toBe("24.00");
    expect(money(0)).toBe("0.00");
  });

  it.each([[null], [undefined]])("writes %s money as empty", (value) => {
    expect(money(value)).toBe("");
  });

  it("writes booleans the way Shopify does", () => {
    expect(bool(true)).toBe("TRUE");
    expect(bool(false)).toBe("FALSE");
  });

  it("writes an ISO date", () => {
    expect(date(new Date("2026-08-05T10:00:00Z"))).toContain("2026-08-05");
    expect(date(null)).toBe("");
  });
});

describe("reading a foreign CSV", () => {
  it("takes the first column name that is present", () => {
    const row = { "Variant Price": "24.00" };
    expect(field(row, "Price", "Variant Price")).toBe("24.00");
  });

  it("is case- and space-insensitive about headers", () => {
    expect(field({ " variant price ": "24.00" }, "Variant Price")).toBe("24.00");
  });

  it("returns empty when no alias matches", () => {
    expect(field({ Other: "x" }, "Price", "Variant Price")).toBe("");
  });

  it.each([
    ["TRUE", true],
    ["true", true],
    ["yes", true],
    ["1", true],
    ["active", true],
    ["FALSE", false],
    ["no", false],
    ["0", false],
  ])("parses %s as %s", (given, expected) => {
    expect(parseBool(given)).toBe(expected);
  });

  it("uses the fallback only for a blank, not for an unknown word", () => {
    // A CSV saying "Draft" under Published means not published; falling back
    // to true there would publish a product the seller marked as a draft.
    expect(parseBool("", true)).toBe(true);
    expect(parseBool("draft", true)).toBe(false);
  });

  it.each([
    ["24.00", 2_400],
    ["24", 2_400],
    ["$24.00", 2_400],
    ["1,234.50", 123_450],
    ["  24.00  ", 2_400],
  ])("parses %s as %i cents", (given, expected) => {
    expect(parseMoneyField(given)).toBe(expected);
  });

  it.each([[""], ["free"], ["abc"]])("returns null for %s", (given) => {
    expect(parseMoneyField(given)).toBeNull();
  });
});
