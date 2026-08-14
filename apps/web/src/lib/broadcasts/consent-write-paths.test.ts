import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Which files are allowed to name `marketingConsentAt` at all.
 *
 * `audience.ts` will not put an address on a recipient list without that
 * column, so it is the whole of Sailo's lawful basis for sending marketing
 * mail. Every behavioural rule around it — the checkout gate, the double
 * opt-in, the nulls written by the import, the admin form and the public API —
 * is pinned by `scripts/scenarios/consent.scenario.ts` against a real
 * database. What no behavioural test can pin is the *next* write: an admin
 * screen, a bulk action or an integration that starts setting the column
 * somewhere none of those tests look. It would not fail anything. It would
 * simply widen who a seller may mail.
 *
 * So this asserts the list of files, from the source. A new one fails here and
 * has to be argued for, which is the point — the question "who may grant
 * consent" should be answered by a reviewer, not by a grep nobody ran.
 *
 * This is a structural invariant, in the same family as `dependencies.test.ts`
 * and the call-order assertions in `actions/orders.test.ts`.
 */

/**
 * Every file naming the column, tests aside.
 *
 * Three roots, because the column and the code around it do not live in the
 * same package: the table is declared in `@sailo/db`, the shape a contact takes
 * on its way out of Sailo is in `@sailo/core`, and the writers sit in this app.
 * Scanning only `src/` would quietly stop covering the other two — the
 * invariant would still pass, having simply looked away from the files it is
 * guarding.
 *
 * `@sailo/core` was added when `resources.ts` left this app, and that move is
 * the argument for this list existing at all: nothing failed, nothing looked
 * wrong, and a file naming the column had silently stepped outside the only
 * check on it. A root is added here whenever code crosses a package boundary,
 * never a file removed from the list below to make this pass.
 */
function filesNaming(pattern: string): string[] {
  return execSync(
    `grep -rl "${pattern}" src/ ../../packages/db/src ../../packages/core/src --include="*.ts" --include="*.tsx" || true`,
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .toSorted();
}

/*
 * The key form — `marketingConsentAt:` — rather than the bare name, because
 * that is the shape every write takes: a key in the object handed to
 * `.values()` or `.set()`. Reads spell it `clients.marketingConsentAt`.
 *
 * Two entries here are not writes and are listed anyway, because the cost of
 * an over-broad allowlist is one reviewer glance and the cost of a narrow one
 * is a write that slips through a clever pattern.
 */
const MAY_NAME_THE_COLUMN = [
  // The column itself, in the package that owns the schema.
  "../../packages/db/src/schema/orders.ts",
  // Checkout. Grant-only, and gated on `shop.askMarketingConsent &&
  // input.marketingOptIn` in `actions/orders.ts` — see orders.test.ts.
  "src/lib/orders/clients.ts",
  // The double opt-in confirmation: the one path that grants consent to
  // somebody who bought nothing, and only behind a link sent to their address.
  "src/lib/broadcasts/subscribe.ts",
  // Adding a contact by hand. Writes a literal null.
  "src/lib/actions/clients.ts",
  // The public API's contact upsert. Writes a literal null.
  "src/lib/api/handlers.ts",
  /*
   * Serialising a contact back out — a read, not a write.
   *
   * In `@sailo/core` since the webhook emitter moved to `@sailo/commerce`: the
   * same shape has to be built for a `contact.created` payload and for
   * `GET /api/v1/contacts/{id}`, and the emitter is no longer in this app.
   * `src/lib/api/resources.ts` is a re-export of it and names nothing itself.
   */
  "../../packages/core/src/resources.ts",
  // The API docs, telling integrators the field is ignored.
  "src/app/(marketing)/docs/api/page.tsx",
  // The MCP tool reference, saying the same thing to an assistant.
  "src/app/(marketing)/docs/mcp/page.tsx",
  // The OpenAPI document. Describes the field; grants nothing.
  "src/lib/api/openapi.ts",
].toSorted();

describe("who may write marketing consent", () => {
  it("is these files and no others", () => {
    /*
     * If this fails on a file you added: it is not asking you to delete the
     * line. It is asking whether the thing being written is consent a *person*
     * gave, or a claim somebody made on their behalf. Only the first may be
     * stored, and only the second is easy to write by accident.
     */
    expect(filesNaming("marketingConsentAt:")).toEqual(MAY_NAME_THE_COLUMN);
  });

  it.each([
    ["src/lib/actions/clients.ts", "a seller typing somebody in"],
    ["src/lib/api/handlers.ts", "an integration posting a contact"],
  ])("%s states the null rather than defaulting it", (file) => {
    /*
     * Stated, not omitted. A column left out of an insert is one that a later
     * `.set()` spread, or a default on the schema, can start filling without
     * anybody editing this line — and the reviewer of that change would see no
     * mention of consent anywhere near it.
     */
    const source = readFileSync(file, "utf8");
    expect(source).toContain("marketingConsentAt: null");
    // The only value it may be given here. Anything else is a claim.
    expect(source.match(/marketingConsentAt: (?!null)/)).toBeNull();
  });

  it("keeps the CSV import out of it entirely", () => {
    /*
     * A CSV can carry a "Marketing Consent At" column — Sailo's own export
     * writes one — and reading it would let a seller assert on somebody else's
     * behalf that they agreed. The import does not mention the column on
     * either branch: not on insert, so nothing is granted, and not on update,
     * so nothing a person gave is revoked by a spreadsheet.
     */
    expect(readFileSync("src/lib/import/clients.ts", "utf8")).not.toMatch(
      /marketingConsentAt:/,
    );
  });

  it("has no path that sets the column in raw SQL", () => {
    /*
     * The allowlist above reads the ORM's spelling. A bulk update written as
     * `sql\`update clients set marketing_consent_at = now()\`` — which is
     * exactly the shape a "fix up this seller's list" script takes — would
     * pass it without appearing in any of those files.
     */
    const hits = execSync(
      `grep -rniE "marketing_consent_at[[:space:]]*=" src/ scripts/ --include="*.ts" --include="*.tsx" || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      // This file names the pattern on purpose.
      .filter((line) => !line.startsWith("src/lib/broadcasts/consent-write-paths.test.ts"));

    expect(hits).toEqual([]);
  });
});
