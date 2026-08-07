import { describe, expect, it } from "vitest";
import { COOKIES, LEGAL } from "./legal";

/**
 * The legal documents are generated from `LEGAL`, so a wrong value there is
 * wrong on three published pages at once and nobody notices — these are facts
 * about a business, and they fail silently in a way code does not.
 */

describe("the operator's contact address", () => {
  /*
   * A contact address on a legal notice has to be somewhere post can arrive.
   * "Masson Ave, San Bruno" is a street, not an address, and a privacy request
   * or a legal notice sent there does not reach anyone. This test is the note
   * in legal.ts made enforceable: it fails until the building number is filled
   * in, so the incomplete version cannot quietly ship.
   */
  it("has a building number, not just a street", () => {
    expect(
      /\d/.test(LEGAL.street),
      `LEGAL.street is "${LEGAL.street}" — a legal notice address needs a building number`,
    ).toBe(true);
  });

  it("carries every part a postal address needs", () => {
    for (const field of ["street", "city", "state", "postalCode", "country"] as const) {
      expect(LEGAL[field].trim(), `LEGAL.${field} is empty`).not.toBe("");
    }
  });
});

describe("cookies the policy declares", () => {
  /*
   * The policy renders this list as the complete set. An entry left here after
   * the cookie stopped being set is a policy describing storage that does not
   * happen; one missing for a cookie that is set is the far worse direction.
   *
   * `sailo_sid` was the analytics cookie, replaced by a derived per-day
   * identifier that touches no device. It must not come back to this table
   * without the consent flow that an analytics cookie would need.
   */
  /*
   * Read as `string` on purpose. `COOKIES` is `as const`, so once the analytics
   * entry was removed TypeScript narrowed `kind` to the two remaining values
   * and comparing against a third became a compile error — the check would have
   * passed by vanishing, which is the opposite of a guard. Widening keeps the
   * assertion real for whatever gets added later.
   */
  const kinds: string[] = COOKIES.map((c) => c.kind);
  const names: string[] = COOKIES.map((c) => c.name);

  it("declares no analytics cookie, because none is set", () => {
    expect(names).not.toContain("sailo_sid");
    expect(kinds).not.toContain("Analytics, first-party");
  });

  it("only declares cookies that are strictly necessary or a preference", () => {
    // Anything outside these two kinds needs prior consent in the EU and UK,
    // and there is no consent mechanism in the product.
    const allowed = new Set([
      "Strictly necessary",
      "Preference",
      // Permitted only because it is gated — the tag does not load until
      // the visitor agrees. See `google-tag-gate.tsx`.
      "Analytics, with consent",
    ]);
    for (const kind of kinds) {
      expect(allowed.has(kind), `unexpected cookie kind "${kind}"`).toBe(true);
    }
  });
});
