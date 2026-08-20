import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROTECTED_SECTIONS } from "./glossary";

/**
 * The only door into a protected money section, and that it stays narrow.
 *
 * `PROTECTED_SECTIONS` refuses whole sections to the filler because a
 * plausible-but-wrong translation of a total, a payout status or a coupon rule
 * is not caught by reading the screen — it is caught by a complaint, after
 * somebody has already acted on it.
 *
 * `--reviewed "<name>"` is the one way past that, and it is worth a test rather
 * than a comment because the failure it prevents is silent in both directions.
 * Remove the `--from` condition and the flag becomes a way to point a model at
 * every money surface in thirty-four languages. Remove the name check and it
 * becomes a flag somebody types to make an error go away, which is exactly the
 * habit the list exists to interrupt.
 *
 * A source-text assertion, in the idiom `notification-switches.test.ts` uses:
 * the property is about which conditions appear in a file, and the script is a
 * CLI outside any package's module graph. It is a weaker test than executing
 * the refusals — which is done by hand — but it is the half that runs on every
 * commit.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FILL = readFileSync(join(HERE, "../../../../scripts/i18n/fill.mts"), "utf8");

describe("writing a protected money section", () => {
  it("is refused unless the translations came from a file", () => {
    /*
     * `client` is null whenever `--from` is set, so requiring `--from` is what
     * makes "a model may never write these" true rather than merely intended.
     */
    expect(FILL).toContain("if (!fromFile) {");
    expect(FILL).toMatch(/--reviewed only applies to --from/);
  });

  it("is refused unless somebody is named", () => {
    // A bare flag records that the guard was bypassed. A name records who is
    // answerable, which is the thing the guard is actually protecting.
    expect(FILL).toMatch(/--reviewed needs a name/);
    expect(FILL).toContain("reviewedBy.startsWith(\"--\")");
  });

  it("is the only condition that widens what may be written", () => {
    /*
     * The filter itself. If this line ever stops mentioning `reviewedBy`, the
     * protection is either always on (and the flag is a lie) or always off.
     */
    expect(FILL).toContain(
      "(key) => reviewedBy !== undefined || !isProtected(surface, key),",
    );
  });

  it("still protects the sections that hold money", () => {
    // A rename that empties the list would make every test above pass while
    // protecting nothing. `assertSectionsExist` catches it at run time; this
    // catches a list that was edited down.
    for (const section of ["billing", "payments", "payouts", "coupons", "orders"]) {
      expect(PROTECTED_SECTIONS.admin).toContain(section);
    }
  });
});
