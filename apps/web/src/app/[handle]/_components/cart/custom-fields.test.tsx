import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomFields, RENDERED_FIELD_TYPES, type CheckoutField } from "./custom-fields";

/**
 * Every question a seller can define has a box a buyer can answer it in.
 *
 * `RENDERED_FIELD_TYPES` was exported for exactly this and nothing asserted
 * against it, so the export sat dead and the rule it names — "a new one cannot
 * ship without a box" — was a comment rather than a check. `knip` is what said
 * so out loud.
 *
 * The failure it guards is quiet in the worst way. `renderInput` ends in a
 * `default` that returns a plain text input, which is the right answer for a
 * type this build has never heard of and the *wrong* one for a type somebody
 * added to the vocabulary and forgot to draw: a seller defines a date field,
 * every buyer gets a text box, and the server then declines answers it asked
 * for. Nothing throws and nothing logs.
 *
 * So the table below is the assertion, and it is keyed rather than counted —
 * adding a type to `FIELD_TYPES` fails this test until somebody adds both a
 * case and the marker that proves the case is reached.
 */

/** What each type must put in the markup, distinct enough to catch a fallthrough. */
const EXPECTED: Record<string, RegExp> = {
  text: /type="text"/,
  longtext: /<textarea/,
  checkbox: /type="checkbox"/,
  // Both are `type="number"`; the step is what separates whole from fractional,
  // and swapping them would let a buyer type 1.5 into a field asking for a count.
  integer: /type="number"[^>]*step="1"/,
  decimal: /type="number"[^>]*step="any"/,
  dropdown: /<select/,
  date: /type="date"/,
  datetime: /type="datetime-local"/,
};

const field = (type: string): CheckoutField => ({
  key: "q",
  label: "A question",
  type,
  options: ["One", "Two"],
  required: false,
});

const markupFor = (type: string) =>
  renderToStaticMarkup(createElement(CustomFields, { fields: [field(type)] }));

describe("the checkout's own questions", () => {
  it("draws a box for every type the vocabulary defines", () => {
    // The whole point of the export: the table cannot fall behind the list.
    expect(Object.keys(EXPECTED).toSorted()).toEqual(
      [...RENDERED_FIELD_TYPES].toSorted(),
    );
  });

  it.each(Object.entries(EXPECTED))("renders %s as its own control", (type, marker) => {
    expect(markupFor(type)).toMatch(marker);
  });

  /*
   * The fallthrough is a feature for an *unknown* type — a row written by a
   * newer deploy than this build — and a text box is the honest thing to show
   * for it. This pins that it still happens, so the test above is measuring a
   * real default rather than an unreachable branch.
   */
  it("falls back to a text box for a type this build has never heard of", () => {
    expect(markupFor("hologram")).toMatch(/type="text"/);
  });

  it("names every input so the panel's own fields cannot be overwritten", () => {
    // `cf:` is why a seller may define a field called `note` or `country`.
    expect(markupFor("text")).toContain('name="cf:q"');
  });

  it("renders nothing at all when the shop asks no questions", () => {
    expect(renderToStaticMarkup(createElement(CustomFields, { fields: [] }))).toBe("");
  });
});
