import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../contact";
import {
  FIELD_TYPES,
  formatAnswer,
  normalizeOptions,
  parseAnswer,
  type FieldShape,
} from "./fields";

/**
 * The eight types, and the two places a seller-defined field is an attack
 * surface rather than a convenience.
 *
 * A custom field is the one thing in the audience where a *seller* names the
 * container and a *buyer* fills it. Everything below is aimed at that: what a
 * type will accept, what it will refuse, and what happens to a value on its way
 * to a CSV or a merge tag.
 */

const field = (over: Partial<FieldShape> = {}): FieldShape => ({
  key: "f",
  type: "text",
  options: [],
  required: false,
  ...over,
});

describe("contact identity", () => {
  it("folds case, because one inbox is one person", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("does not fold dots or plus aliases", () => {
    /*
     * `a.b@gmail.com` reaches the same inbox as `ab@gmail.com` and is a
     * different account. Treating them as equal is what lets somebody
     * registering an alias act as the holder of the address — the reasoning
     * `staff_members` already documents, and it applies with more force here,
     * where the consequence is reading somebody else's order history.
     */
    expect(normalizeEmail("a.b@example.com")).toBe("a.b@example.com");
    expect(normalizeEmail("ab+news@example.com")).toBe("ab+news@example.com");
    expect(normalizeEmail("a.b@example.com")).not.toBe(normalizeEmail("ab@example.com"));
  });
});

describe("every type parses or refuses", () => {
  it("covers all eight", () => {
    // A type added to the vocabulary and not to `parseAnswer` falls through to
    // the default and refuses everything — which is safe, and silent. This is
    // the test that makes it loud.
    for (const type of FIELD_TYPES) {
      const sample =
        type === "checkbox" ? "on"
        : type === "integer" ? "3"
        : type === "decimal" ? "3.5"
        : type === "date" ? "2026-08-19"
        : type === "datetime" ? "2026-08-19T09:00:00Z"
        : type === "dropdown" ? "Small"
        : "hello";
      const parsed = parseAnswer(field({ type, options: ["Small"] }), sample);
      expect(parsed.ok, `${type} refused its own sample`).toBe(true);
    }
  });

  it("refuses a number that is not one", () => {
    expect(parseAnswer(field({ type: "integer" }), "3.5")).toEqual({ ok: false, problem: "type" });
    expect(parseAnswer(field({ type: "integer" }), "1e9")).toEqual({ ok: false, problem: "type" });
    expect(parseAnswer(field({ type: "integer" }), "٣")).toEqual({ ok: false, problem: "type" });
    expect(parseAnswer(field({ type: "decimal" }), "1,5")).toEqual({ ok: false, problem: "type" });
  });

  it("refuses a day that does not exist", () => {
    // `2026-02-30` matches `\d{4}-\d{2}-\d{2}` and is not a date. Shape is not
    // validation.
    expect(parseAnswer(field({ type: "date" }), "2026-02-30")).toEqual({
      ok: false,
      problem: "type",
    });
    expect(parseAnswer(field({ type: "date" }), "2026-02-28")).toEqual({
      ok: true,
      value: "2026-02-28",
    });
  });

  it("stores a datetime as an instant, so two shops in two zones sort alike", () => {
    expect(parseAnswer(field({ type: "datetime" }), "2026-08-19T09:00:00+02:00")).toEqual({
      ok: true,
      value: "2026-08-19T07:00:00.000Z",
    });
  });

  it("refuses a type this build does not know", () => {
    // A row written by a newer deploy. Coercing it to text would let that
    // type's validation be skipped by anything still running this build.
    expect(parseAnswer(field({ type: "colour" }), "red")).toEqual({
      ok: false,
      problem: "type",
    });
  });
});

describe("required", () => {
  it("refuses a blank answer to a required field", () => {
    expect(parseAnswer(field({ required: true }), "  ")).toEqual({
      ok: false,
      problem: "required",
    });
  });

  it("reads a required checkbox as must-be-ticked", () => {
    // Which is what a terms box is. A checkbox has no blank — an unticked box
    // submits nothing at all, and that is `false`, not "unanswered".
    const box = field({ type: "checkbox", required: true });
    expect(parseAnswer(box, undefined)).toEqual({ ok: false, problem: "required" });
    expect(parseAnswer(box, "on")).toEqual({ ok: true, value: true });
  });

  it("reads an optional unticked checkbox as false, not null", () => {
    expect(parseAnswer(field({ type: "checkbox" }), undefined)).toEqual({
      ok: true,
      value: false,
    });
  });
});

describe("dropdown options", () => {
  it("drops blanks and duplicates, keeping the seller's order", () => {
    expect(normalizeOptions(["Large", " ", "Small", "large", "Small"])).toEqual([
      "Large",
      "Small",
    ]);
  });

  it("flattens a pasted list's newlines rather than storing them", () => {
    // An option carrying a newline breaks the CSV export it will end up in.
    expect(normalizeOptions(["a\nb"])).toEqual(["a b"]);
  });
});

describe("reading an answer back", () => {
  it("renders nothing for an unanswered field, not the word null", () => {
    expect(formatAnswer(null, "text")).toBe("");
  });

  it("keeps a value verbatim, leaving escaping to whatever renders it", () => {
    /*
     * Deliberately not escaped here. Merge tags are substituted into finished
     * HTML and escaped at that boundary — the existing rule from `markdown.ts`
     * — and a value escaped twice renders `&amp;` to a buyer.
     */
    expect(formatAnswer("Bed & Breakfast", "text")).toBe("Bed & Breakfast");
  });
});
