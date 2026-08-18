import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";

/**
 * A finding about a shop that somebody has to look at, and what they decided.
 *
 * ─── WHY A TABLE AT ALL, WHEN THE SIGNALS ARE ALREADY IN THE DATABASE ────────
 * The risk desk in /hq ranks shops by arithmetic over rows that already exist:
 * chargeback rate from `disputes`, refund rate and velocity from `orders`,
 * whether the account has a second factor, whether Stripe is enabled, whether
 * the shop's own words trip the restricted-business screen. None of that needs
 * storing — it is derived at read time from a bounded query, deliberately, so
 * that the risk desk costs one query and not a nightly job writing a row per
 * shop per day for a number nobody asked for on most of them.
 *
 * What *cannot* be derived is the human half. A shop selling replica watches
 * scores the same on Tuesday as it did on Monday, and the difference between
 * the two days is that on Monday somebody read it and decided. Without
 * somewhere to write that down, the desk re-presents every finding it has ever
 * made, for ever, which is precisely how a queue teaches the people staffing it
 * to scroll past the top of it. So this table holds the decisions, not the
 * measurements.
 *
 * ─── RAISED AND CLEARED, NEVER DELETED ───────────────────────────────────────
 * `clearedAt` is what takes a flag off the desk, in the same shape and for the
 * same reason as `staff_members.revoked_at`: the question after an incident is
 * "did anybody see this coming, and what did they say", and a deleted row
 * answers it with silence. A flag that was raised and dismissed in ninety
 * seconds by somebody who turned out to be wrong is the single most useful row
 * in this table, and it only exists if clearing is a write rather than a
 * delete.
 *
 * A cleared flag is not a permanent pardon. The desk re-raises a flag of the
 * same kind when the evidence moves past what it was when it was cleared —
 * `clearedAtValue` is what "moved past" is measured from — which is the same
 * design as `shops.disputeClearedAt` and exists for the same reason: an
 * automated check that can be silenced for ever is one somebody will silence.
 */
export const riskFlags = pgTable(
  "risk_flags",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /**
     * What kind of finding this is — `chargebacks`, `velocity`, `refunds`,
     * `restricted_business`, `returning_closure`, `manual`.
     *
     * Text and not an enum, matching every other status column in this schema:
     * adding a signal should be a deploy, not a migration that takes a lock on
     * the table. The vocabulary lives in `@sailo/core/risk`, which is where the
     * thing that raises them can be read alongside the thing that names them.
     */
    kind: text("kind").notNull(),

    /**
     * `watch` | `review` | `act` — how loud this finding is.
     *
     * Deliberately not a number. A 0–100 score invites the question "is 61 worse
     * than 59" which has no answer, and it hides the only distinction the desk
     * actually works from: whether this is something to keep an eye on, something
     * to read today, or something to do something about now.
     */
    severity: text("severity").$type<"watch" | "review" | "act">().notNull(),

    /** One sentence, in the present tense, readable by whoever picks it up. */
    summary: text("summary").notNull(),

    /**
     * The number the finding was raised on — a chargeback rate in basis points,
     * an order count, a multiple. Text because the unit differs by kind and
     * nothing compares two kinds to each other.
     *
     * Its job is re-raising: a `chargebacks` flag cleared at 180bp comes back
     * when the rate passes it again, and without the value at clearance there
     * is nothing to compare against but the threshold, which is where it was
     * when somebody already looked.
     */
    evidence: text("evidence"),

    raisedAt: timestamp("raised_at").defaultNow().notNull(),
    /**
     * Who raised it. Null when the desk did — which is the common case, and the
     * reason this is nullable rather than defaulted to a fake address.
     */
    raisedByEmail: text("raised_by_email"),

    /** Null means still on the desk. This is the whole open/closed check. */
    clearedAt: timestamp("cleared_at"),
    clearedByEmail: text("cleared_by_email"),
    /** Why it was dismissed. Required by the action, so it is never null in practice. */
    clearedReason: text("cleared_reason"),
    /** `evidence` at the moment it was cleared — see the note on `evidence`. */
    clearedAtValue: text("cleared_at_value"),
  },
  (t) => [
    /**
     * The desk's only query: everything still open, worst first. Partial, so
     * the index holds open flags alone — cleared rows are kept for ever and
     * would otherwise grow an index nothing reads them through.
     */
    index("risk_flags_open_idx")
      .on(t.raisedAt)
      .where(sql`${t.clearedAt} is null`),
    /** One shop's history, which is what the account page shows. */
    index("risk_flags_shop_idx").on(t.shopId, t.raisedAt),
  ],
);
