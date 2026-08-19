import { describe, expect, it } from "vitest";
import {
  DATA_REQUEST_MESSAGES,
  DATA_REQUEST_WINDOW_DAYS,
  ERASED_CATEGORIES,
  ERASURE_RULES,
  RETAINED_CATEGORIES,
  ANONYMOUS_CATEGORIES,
  REFUSAL_REASONS,
  daysLeft,
  dueBy,
  erasureRuleFor,
  isDataRequestKind,
  isRefusalReason,
  refusalBody,
} from "./index";

/**
 * The decision table is the spec, so every row of it gets a named test.
 *
 * Spec 52 says exactly that, and it is not ceremony: each row is a category of
 * personal data and a promise about what happens to it. A row whose verdict
 * quietly changed would alter what a buyer is told they can have deleted, and
 * nothing else in the system would notice.
 */

describe("the erasure decision table", () => {
  it("has a rule for every category exactly once", () => {
    const names = ERASURE_RULES.map((rule) => rule.category);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every rule a reason a buyer can be shown", () => {
    for (const rule of ERASURE_RULES) {
      // The reason is what goes in the reply. A blank one would produce a
      // refusal with no answer in it, which is the thing "a refusal is an
      // answer" exists to prevent.
      expect(rule.reason.length, rule.category).toBeGreaterThan(20);
    }
  });

  it("throws on a category nobody has decided about", () => {
    /*
     * Loudly, and not as a silent `retain`. A category the table has never
     * heard of is personal data somebody added without deciding what an
     * erasure does to it.
     */
    expect(() => erasureRuleFor("shoe_size")).toThrow(/ERASURE_RULES/);
  });

  /* ── One test per row, in the spec's own order ─────────────────────────── */

  it("erases nothing from the customer record and pseudonymises it instead", () => {
    // The row the orders point at. Deleting it breaks the ledger, which spec 03
    // already decided for sellers and which cannot be decided differently here.
    expect(erasureRuleFor("contact_details").verdict).toBe("pseudonymise");
  });

  it("erases marketing consent and list membership outright", () => {
    expect(erasureRuleFor("marketing_consent").verdict).toBe("erase");
  });

  it("reports visits and clicks as holding no identifier at all", () => {
    /*
     * Not "erased". Both are keyed on a rotating `sessionId` that is never
     * stored against an email or a client id, so there is no query that could
     * select this person's rows — and claiming a delete that did not happen is
     * a false statement on the one feature whose whole output is a true one.
     */
    expect(erasureRuleFor("visits_and_clicks").verdict).toBe("already_anonymous");
  });

  it("retains the message log as tax and dispute evidence", () => {
    expect(erasureRuleFor("order_messages").verdict).toBe("retain");
    expect(erasureRuleFor("order_messages").reason).toMatch(/400 days/);
  });

  it("retains orders and invoices, and says why", () => {
    const rule = erasureRuleFor("orders_and_invoices");
    expect(rule.verdict).toBe("retain");
    expect(rule.reason).toMatch(/invoice sequence/i);
  });

  it("retains the purchase identifiers only while a dispute can still arrive", () => {
    const rule = erasureRuleFor("purchase_identifiers");
    expect(rule.verdict).toBe("retain");
    // The qualifier is the whole difference between "retained" and "retained
    // for ever", and it is a real deadline rather than a euphemism.
    expect(rule.whileDisputeWindowOpen).toBe(true);
  });

  it("retains the download log on the same clock as the identifiers", () => {
    const rule = erasureRuleFor("download_events");
    expect(rule.verdict).toBe("retain");
    expect(rule.whileDisputeWindowOpen).toBe(true);
  });

  it("never erases a suppression, and says so in the reason", () => {
    /*
     * THE ONE PEOPLE GET WRONG.
     *
     * A suppression is how somebody's objection is honoured. Erasing it
     * re-subscribes the person who asked to be left alone — the one "deletion"
     * that does the opposite of what was asked — so it is not merely retained,
     * it is `never_erase`, and the buyer is told.
     */
    const rule = erasureRuleFor("email_suppressions");
    expect(rule.verdict).toBe("never_erase");
    expect(rule.reason).toMatch(/permanently and on purpose/);
    expect(rule.reason).toMatch(/back on the list/);
  });

  it("pseudonymises tickets and memberships rather than deleting them", () => {
    expect(erasureRuleFor("tickets_and_memberships").verdict).toBe("pseudonymise");
  });

  it("splits every rule into exactly one of the three screens' lists", () => {
    // The confirmation screen renders these three and nothing else, so a rule
    // in none of them would be a promise the seller never sees before acting.
    const total =
      ERASED_CATEGORIES.length +
      RETAINED_CATEGORIES.length +
      ANONYMOUS_CATEGORIES.length;
    expect(total).toBe(ERASURE_RULES.length);
  });

  it("never puts a suppression in the list of things that are removed", () => {
    expect(ERASED_CATEGORIES.map((rule) => rule.category)).not.toContain(
      "email_suppressions",
    );
    expect(RETAINED_CATEGORIES.map((rule) => rule.category)).toContain(
      "email_suppressions",
    );
  });
});

describe("the statutory clock", () => {
  it("runs thirty days from verification", () => {
    const verified = new Date("2026-08-19T10:00:00.000Z");
    expect(dueBy(verified).toISOString()).toBe("2026-09-18T10:00:00.000Z");
  });

  it("is one month, which is what the law says", () => {
    expect(DATA_REQUEST_WINDOW_DAYS).toBe(30);
  });

  it("counts down, and keeps counting once overdue", () => {
    const due = new Date("2026-08-19T00:00:00.000Z");
    expect(daysLeft(due, new Date("2026-08-12T00:00:00.000Z"))).toBe(7);
    expect(daysLeft(due, new Date("2026-08-19T00:00:00.000Z"))).toBe(0);
    /*
     * Negative rather than clamped at zero. A missed statutory deadline is a
     * fact the seller has to keep seeing; a queue that showed every overdue row
     * as "0 days left" would teach them the number stops meaning anything.
     */
    expect(daysLeft(due, new Date("2026-08-22T00:00:00.000Z"))).toBe(-3);
  });

  it("has nothing to count for an unverified request", () => {
    // No verification means no request from anybody, so no clock.
    expect(daysLeft(null)).toBeNull();
  });
});

describe("refusals", () => {
  it("is a closed list", () => {
    expect(isRefusalReason("legal_obligation")).toBe(true);
    expect(isRefusalReason("i_am_busy")).toBe(false);
    expect(isRefusalReason(null)).toBe(false);
  });

  it("gives every reason a sentence the buyer is actually sent", () => {
    for (const reason of REFUSAL_REASONS) {
      expect(refusalBody(reason.id), reason.id).toBeTruthy();
    }
  });

  it("has no body for a reason that is not on the list", () => {
    expect(refusalBody("made_it_up")).toBeNull();
  });
});

describe("request kinds", () => {
  it.each(["access", "erasure", "portability"])("accepts %s", (kind) => {
    expect(isDataRequestKind(kind)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isDataRequestKind("delete_everything")).toBe(false);
    expect(isDataRequestKind(undefined)).toBe(false);
  });
});

describe("the public form's one sentence", () => {
  it("says nothing about whether the address was found", () => {
    /*
     * The form's subject is literally whether a person is in a database, so the
     * copy is part of the access control rather than decoration. Anything
     * conditional here — "we found you", "no record" — is a customer-list
     * oracle wearing a helpful tone.
     */
    const message = DATA_REQUEST_MESSAGES.received;
    expect(message).toMatch(/if we hold anything/i);
    expect(message).not.toMatch(/\bno record\b|\bnot found\b|\bfound you\b/i);
  });

  it("keeps the outage message separate from the answer", () => {
    // Decision B: a fail-closed refusal is not an answer about the request.
    expect(DATA_REQUEST_MESSAGES.unavailable).not.toBe(
      DATA_REQUEST_MESSAGES.received,
    );
    expect(DATA_REQUEST_MESSAGES.unavailable).toMatch(/couldn't take|try again/i);
  });
});
