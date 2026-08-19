import { describe, expect, it } from "vitest";
import {
  DESCRIPTOR_MAX,
  checkDescriptor,
  descriptorFromName,
  descriptorPreview,
} from "./descriptor";
import {
  POLICY_BODY_MAX,
  isStorablePolicy,
  normalisePolicy,
  policyHash,
} from "./policy";
import { REDACTED, redactTokens } from "./messages";

/**
 * Spec 44's pure rules — the three that decide whether the captured evidence is
 * worth anything.
 *
 * Each corresponds to a way the capture silently fails rather than errors:
 * a descriptor Stripe drops without saying so, a policy snapshot that writes a
 * new row on every save until "one row per policy" becomes one per order, and a
 * message log that stores live bearer tokens and hands them to a card network.
 */

describe("the statement descriptor", () => {
  /*
   * WHY THIS IS VALIDATED AT ALL
   *
   * Stripe *silently ignores* an invalid descriptor: the charge succeeds and the
   * account default is used. The seller's settings screen says one thing, their
   * buyers' statements say another, and the only way anybody finds out is the
   * `unrecognized` chargeback the descriptor existed to prevent.
   */
  it("accepts an ordinary shop name", () => {
    expect(checkDescriptor("SPECKLED CERAMICS")).toEqual({
      ok: true,
      value: "SPECKLED CERAMICS",
    });
  });

  it("collapses whitespace, so two visually identical entries agree", () => {
    expect(checkDescriptor("  SPECKLED   CERAMICS  ")).toEqual({
      ok: true,
      value: "SPECKLED CERAMICS",
    });
  });

  it("refuses the five characters the networks reject", () => {
    for (const bad of ["<b>Shop", "Shop>", "Sh\\op", 'Shop "X"', "Shop's"]) {
      expect(checkDescriptor(bad), bad).toEqual({
        ok: false,
        problem: "forbidden_character",
      });
    }
  });

  it("refuses a line with no letter in it", () => {
    /*
     * A statement line of digits is indistinguishable from a reference number,
     * which is the confusion this field exists to remove.
     */
    expect(checkDescriptor("12345678")).toEqual({ ok: false, problem: "no_letter" });
    expect(checkDescriptor("--- ---")).toEqual({ ok: false, problem: "no_letter" });
  });

  it("accepts a non-Latin script", () => {
    // `\p{L}`, not `[a-z]`: this platform sells in 35 languages.
    expect(checkDescriptor("سيلو متجر").ok).toBe(true);
    expect(checkDescriptor("スペックル陶器").ok).toBe(true);
  });

  it("refuses too short and too long", () => {
    expect(checkDescriptor("AB")).toEqual({ ok: false, problem: "too_short" });
    expect(checkDescriptor("A".repeat(DESCRIPTOR_MAX + 1))).toEqual({
      ok: false,
      problem: "too_long",
    });
    expect(checkDescriptor("A".repeat(DESCRIPTOR_MAX)).ok).toBe(true);
  });

  it("refuses empty and null the same way", () => {
    expect(checkDescriptor("")).toEqual({ ok: false, problem: "empty" });
    expect(checkDescriptor("   ")).toEqual({ ok: false, problem: "empty" });
    expect(checkDescriptor(null)).toEqual({ ok: false, problem: "empty" });
    expect(checkDescriptor(undefined)).toEqual({ ok: false, problem: "empty" });
  });
});

describe("defaulting a descriptor from the shop's name", () => {
  it("uses the name when the name is usable", () => {
    expect(descriptorFromName("Speckled Ceramics")).toBe("Speckled Ceramics");
  });

  it("truncates a long name rather than refusing it", () => {
    const value = descriptorFromName("Speckled Ceramics of North Bristol Limited");
    expect(value).toBe("Speckled Ceramics of N");
    expect(value!.length).toBe(DESCRIPTOR_MAX);
  });

  it("repairs a name containing a forbidden character", () => {
    expect(descriptorFromName(`Ada's Ceramics`)).toBe("Ada s Ceramics");
  });

  it("returns null rather than something Stripe would drop", () => {
    /*
     * Null is honest: it means the account default applies, which is what the
     * seller has today. A value that looks configured and is silently ignored is
     * strictly worse than no value.
     */
    expect(descriptorFromName("123")).toBeNull();
    expect(descriptorFromName("'''")).toBeNull();
    expect(descriptorFromName("")).toBeNull();
    expect(descriptorFromName(null)).toBeNull();
  });
});

describe("the preview the buyer is shown at checkout", () => {
  /*
   * Worth more than everything else in this file: it prevents the dispute
   * rather than answering it.
   */
  it("joins the prefix and the suffix the way Stripe does", () => {
    expect(descriptorPreview("SPECKLED", "MUG")).toBe("SPECKLED MUG");
  });

  it("truncates the join to the network limit", () => {
    const preview = descriptorPreview("SPECKLED CERAMICS", "ORDER 12345");
    expect(preview!.length).toBeLessThanOrEqual(DESCRIPTOR_MAX);
    expect(preview).toBe("SPECKLED CERAMICS ORDE");
  });

  it("drops a suffix that would be rejected, keeping the valid prefix", () => {
    expect(descriptorPreview("SPECKLED", `<b>`)).toBe("SPECKLED");
    expect(descriptorPreview("SPECKLED", "")).toBe("SPECKLED");
  });

  it("shows nothing when there is nothing valid to show", () => {
    // Not a guess at the account default — we do not know it.
    expect(descriptorPreview(null, "MUG")).toBeNull();
    expect(descriptorPreview("12", "MUG")).toBeNull();
  });
});

describe("identifying a policy by what it says", () => {
  const POLICY =
    "Refunds are available within 14 days of delivery, provided the item is unused and in its original packaging.";

  it("gives the same hash for the same text", async () => {
    expect(await policyHash(POLICY)).toBe(await policyHash(POLICY));
  });

  it("ignores changes that do not change what was agreed", async () => {
    /*
     * THE PROPERTY THAT MAKES SNAPSHOTTING AFFORDABLE
     *
     * Hashing raw bytes writes a new row for a trailing space, a Windows line
     * ending, or a reflowed blank line — none of which change the promise, and
     * all of which would turn "one row per policy" into one row per save, which
     * is one row per order in practice.
     */
    const base = await policyHash(POLICY);
    expect(await policyHash(`${POLICY}   `)).toBe(base);
    expect(await policyHash(`  ${POLICY}`)).toBe(base);
    expect(await policyHash(POLICY.replace(/ /g, " ") + "\n\n\n")).toBe(base);

    const withCrlf = "Refunds:\r\nWithin 14 days.";
    const withLf = "Refunds:\nWithin 14 days.";
    expect(await policyHash(withCrlf)).toBe(await policyHash(withLf));

    const trailingPerLine = "Refunds:   \nWithin 14 days.   ";
    expect(await policyHash(trailingPerLine)).toBe(await policyHash(withLf));
  });

  it("changes when a word changes", async () => {
    expect(await policyHash(POLICY)).not.toBe(
      await policyHash(POLICY.replace("14 days", "30 days")),
    );
  });

  it("changes when punctuation changes, because the promise did", async () => {
    /*
     * Deliberately not case-folded and not punctuation-stripped. "You may cancel
     * within 14 days" and "You may cancel within 14 days." are different things
     * to argue about, and merging them would be a normaliser deciding a question
     * that belongs to a lawyer.
     */
    expect(await policyHash("Cancel within 14 days")).not.toBe(
      await policyHash("Cancel within 14 days."),
    );
    expect(await policyHash("Cancel Within 14 Days")).not.toBe(
      await policyHash("cancel within 14 days"),
    );
  });

  it("normalises to exactly what gets stored", () => {
    /*
     * The stored body must be the hashed body. Hashing one string and storing
     * another means the hash stops identifying the row, and deduplication
     * silently stops working.
     */
    expect(normalisePolicy("a  \r\n\r\n\r\n\r\nb  ")).toBe("a\n\nb");
  });
});

describe("what is worth snapshotting", () => {
  it("refuses something too short to be a policy", () => {
    /*
     * The realistic failure is a cookie banner scraped off a 404 page, which
     * would then be printed in an evidence pack as the seller's refund terms.
     */
    expect(isStorablePolicy("Not found")).toBe(false);
    expect(isStorablePolicy("")).toBe(false);
  });

  it("accepts a real policy and refuses an unbounded one", () => {
    expect(isStorablePolicy("Refunds are available within 14 days of delivery.")).toBe(
      true,
    );
    expect(isStorablePolicy("x".repeat(POLICY_BODY_MAX + 1))).toBe(false);
  });
});

describe("redacting a stored message", () => {
  /*
   * These rows are read by staff answering a dispute and printed into a document
   * that goes to a card network. A download link is a bearer token — no login,
   * that is what makes it work for a buyer with no account — and neither of
   * those places should ever hold a live one.
   */
  it("removes a download token and keeps the shape", () => {
    expect(
      redactTokens("Your files: https://sailo.store/download/tok_abc123XYZ"),
    ).toBe(`Your files: https://sailo.store/download/${REDACTED}`);
  });

  it("keeps the file id after a download token, which grants nothing", () => {
    expect(
      redactTokens("https://sailo.store/download/tok_abc123/9f2b"),
    ).toBe(`https://sailo.store/download/${REDACTED}/9f2b`);
  });

  it("removes an invoice, portal and unsubscribe token", () => {
    const body = [
      "https://sailo.store/invoice/inv_tok_1",
      "https://sailo.store/u/unsub_tok_2",
      "https://sailo.store/portal/portal_tok_3",
    ].join("\n");
    expect(redactTokens(body)).toBe(
      [
        `https://sailo.store/invoice/${REDACTED}`,
        `https://sailo.store/u/${REDACTED}`,
        `https://sailo.store/portal/${REDACTED}`,
      ].join("\n"),
    );
  });

  it("removes a token in a query string", () => {
    expect(redactTokens("Open https://sailo.store/x?token=abc&ref=1")).toBe(
      `Open https://sailo.store/x?token=${REDACTED}&ref=1`,
    );
    expect(redactTokens("…?a=1&secret=shh")).toBe(`…?a=1&secret=${REDACTED}`);
  });

  it("stops at the end of a URL rather than swallowing the sentence", () => {
    expect(
      redactTokens("Go to https://sailo.store/download/tok_1 and save them."),
    ).toBe(`Go to https://sailo.store/download/${REDACTED} and save them.`);
  });

  it("leaves ordinary prose alone", () => {
    /*
     * This is evidence. A redactor that rewrote the message would destroy the
     * thing the row is for — matching on token *paths* rather than on
     * token-shaped strings is what keeps order references and product slugs.
     */
    const body =
      "Thanks for your order #A-1043. Your Speckled Mug ships Tuesday. Reply here with any questions.";
    expect(redactTokens(body)).toBe(body);
  });

  it("does not redact a word that merely contains a marker", () => {
    expect(redactTokens("See the downloads page for details.")).toBe(
      "See the downloads page for details.",
    );
  });
});
