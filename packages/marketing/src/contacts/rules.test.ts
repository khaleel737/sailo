import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { and } from "drizzle-orm";
import { mailable } from "../broadcasts/audience";
import {
  fieldKeyProblem,
  parseAnswer,
  RESERVED_FIELD_KEYS,
  suggestFieldKey,
  type FieldShape,
} from "./fields";
import { MEMBER_STATUSES } from "./membership";

/**
 * The eight rules of spec 34, one test each, named after the rule.
 *
 * Their page exists because these are the questions every mailing tool gets
 * wrong, and the reason each one is tested *here* rather than only in a
 * scenario is that the scenario proves the behaviour on the day it runs while
 * this proves the mechanism. Four of the eight are decided by a single WHERE
 * clause, and the failure mode that matters is not "the query returned the
 * wrong rows" — it is somebody moving one of those conditions out of the
 * statement and into a filter afterwards, where the next caller will not have
 * it. So those four are asserted against the rendered SQL.
 *
 * The database-shaped half of each rule — that the row really is written, that
 * the send really is skipped — is `apps/web/e2e/scenarios/audience.scenario.ts`,
 * which the spec asks for by name. Neither replaces the other.
 */

const dialect = new PgDialect();

/** The `mailable` floor as SQL, which is where four of the eight rules live. */
function floor(listIds: readonly string[] = []): string {
  const clause = and(...mailable("shop-1", listIds));
  return dialect.sqlToQuery(clause!).sql.replace(/\s+/g, " ");
}

describe("rule 1 — adding to a list does not resurrect a past unsubscribe", () => {
  it("keeps the suppression check in the audience, where a list cannot reach it", () => {
    /*
     * The rule is enforced by absence at the write and presence here: nothing
     * in `joinList` reads suppressions, and this NOT EXISTS is what makes that
     * safe. A suppressed contact gets a `contact_list_members` row and is
     * still not in this result.
     */
    expect(floor(["list-1"])).toContain("not exists");
    expect(floor(["list-1"])).toContain('"email_suppressions"');
  });

  it("matches the suppression on the folded address", () => {
    // `email_suppressions.email` is stored lowercase and `clients.email` as the
    // buyer typed it. A raw comparison reports an unsubscribed `Ada@` as
    // mailable, which is the one mistake the table exists to prevent.
    expect(floor()).toContain('lower("clients"."email")');
  });
});

describe("rule 2 — remove from list is not unsubscribe", () => {
  it("has a status for leaving one list that is not a suppression", () => {
    expect(MEMBER_STATUSES).toContain("removed");
  });

  it("excludes a removed member from a list send without suppressing them", () => {
    const sql = floor(["list-1"]);
    // The list narrowing asks for `subscribed` only, so `removed` drops out of
    // this list — and nothing about the suppression clause changed, so the
    // other lists they are on are untouched.
    expect(sql).toContain("'subscribed'");
    expect(sql).toContain('"contact_list_members"');
  });
});

describe("rule 3 — who receives is the audience minus suppression minus no-consent", () => {
  it("keeps the consent floor inside the query, ANDed, never a post-filter", () => {
    const sql = floor(["list-1"]);
    expect(sql).toContain('"clients"."marketing_consent_at" is not null');
    // All of it in one clause: consent, suppression and the list, joined by
    // `and`. A rule moved out of here is a rule the next caller does not get.
    expect(sql).toContain("and");
    expect(sql).toContain("not exists");
  });

  it("narrows by list without replacing any part of the floor", () => {
    const withList = floor(["list-1"]);
    for (const fragment of [
      '"clients"."marketing_consent_at" is not null',
      '"clients"."email" is not null',
      "not exists",
    ]) {
      expect(withList).toContain(fragment);
    }
  });
});

describe("rule 4 — one person, one email per campaign, even on three lists", () => {
  it("asks the lists as an EXISTS rather than a join", () => {
    /*
     * A join returns a contact once per list they are on. This is the
     * difference between mailing somebody on Regulars and Wholesale once and
     * mailing them twice, and it is a property of the statement rather than of
     * a pass afterwards.
     */
    const sql = floor(["list-1", "list-2"]);
    expect(sql).toContain("exists (");
    expect(sql.startsWith("select")).toBe(false);
  });

  it("scopes the lists to the shop inside the same EXISTS", () => {
    // A list id arrives from a form. An audience built from another shop's
    // list would mail their customers on this shop's quota.
    expect(floor(["list-1"])).toContain('"contact_lists"."shop_id"');
  });
});

describe("rule 5 — adding an existing address updates rather than duplicates", () => {
  const custom: FieldShape = { key: "size", type: "text", options: [], required: false };

  it("tells an empty answer from an absent one, which is what blank-vs-zero needs", () => {
    // `null` is "asked and left blank". It is not `""` and it is not `0`, and
    // an import uses exactly this difference to leave a custom field alone.
    expect(parseAnswer(custom, "")).toEqual({ ok: true, value: null });
    expect(parseAnswer(custom, "   ")).toEqual({ ok: true, value: null });
  });

  it("does not read an empty integer as zero", () => {
    const field: FieldShape = { key: "n", type: "integer", options: [], required: false };
    expect(parseAnswer(field, "")).toEqual({ ok: true, value: null });
    expect(parseAnswer(field, "0")).toEqual({ ok: true, value: 0 });
  });
});

describe("rule 6 — double opt-in per list", () => {
  it("has a state a member sits in while unconfirmed", () => {
    expect(MEMBER_STATUSES).toContain("pending");
  });

  it("leaves a pending member out of the audience", () => {
    // The narrowing asks for `subscribed`; `pending` is not it. A member
    // waiting on a click in their own inbox is not a recipient.
    const sql = floor(["list-1"]);
    expect(sql).toContain("'subscribed'");
    expect(sql).not.toContain("'pending'");
  });
});

describe("rule 7 — custom fields are per-shop, typed and merge-taggable", () => {
  it("refuses a key that is not an identifier", () => {
    expect(fieldKeyProblem("shirt_size")).toBeNull();
    expect(fieldKeyProblem("Shirt Size")).toBe("shape");
    expect(fieldKeyProblem("shirt.size")).toBe("shape");
    expect(fieldKeyProblem("shirt}}size")).toBe("shape");
    expect(fieldKeyProblem("1size")).toBe("shape");
    expect(fieldKeyProblem("")).toBe("empty");
    expect(fieldKeyProblem("a".repeat(41))).toBe("shape");
  });

  it("refuses a key that would shadow a standard one in a merge tag", () => {
    for (const key of RESERVED_FIELD_KEYS) {
      expect(fieldKeyProblem(key)).toBe("reserved");
    }
  });

  it("suggests a key from a label, or nothing rather than something meaningless", () => {
    expect(suggestFieldKey("Shirt size")).toBe("shirt_size");
    // Reserved after folding — a suggestion that would be refused is not one.
    expect(suggestFieldKey("Phone")).toBeNull();
    // Nothing survives the fold, so there is nothing to suggest.
    expect(suggestFieldKey("¿?")).toBeNull();
  });

  it("holds a dropdown to its own closed set", () => {
    const field: FieldShape = {
      key: "size",
      type: "dropdown",
      options: ["Small", "Large"],
      required: false,
    };
    expect(parseAnswer(field, "Large")).toEqual({ ok: true, value: "Large" });
    // A `<select>` constrains a browser, not a request. This is the check that
    // stops an unreviewed string reaching a CSV export as a formula.
    expect(parseAnswer(field, "=cmd|'/c calc'!A1")).toEqual({
      ok: false,
      problem: "option",
    });
    // Exact, not folded: "large" and "Large" would split one report column.
    expect(parseAnswer(field, "large")).toEqual({ ok: false, problem: "option" });
  });
});

describe("rule 8 — account-level opt-out is absolute", () => {
  it("is the same one clause a list send cannot get around", () => {
    // Whether or not a list is named, the suppression check is in the WHERE.
    expect(floor()).toContain("not exists");
    expect(floor(["list-1"])).toContain("not exists");
  });

  it("does not treat consent and suppression as one column", () => {
    /*
     * The two are separate conditions, which is what makes lifting a
     * suppression safe: it restores an address to *mailable if consented*,
     * and somebody who never consented still receives nothing.
     */
    const sql = floor();
    expect(sql).toContain('"clients"."marketing_consent_at" is not null');
    expect(sql).toContain('"email_suppressions"');
  });
});
