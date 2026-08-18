import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Who works at Sailo, and what they are allowed to do here.
 *
 * This replaces `SAILO_STAFF_EMAILS` — an environment variable holding a
 * comma-separated allowlist, where adding a colleague meant a redeploy and
 * removing one meant a redeploy you had to remember to do. That variable still
 * exists and still admits, but only as break-glass; see `staffEmails()` in
 * `@sailo/security/staff` for why it was kept rather than deleted.
 *
 * THE EMAIL IS THE IDENTITY, NOT A USER ID
 * There is deliberately no foreign key to `user`. A member is invited *before*
 * they have an account: the invite writes a row here, and better-auth creates
 * the `user` row the moment they click the link mailed to them. A reference to
 * `user.id` would make the ordinary case — inviting someone new — impossible to
 * express, and would leave the roster unable to say anything about a person
 * until after they had already been let in.
 *
 * Stored lowercased, and `staff_members_email_key` enforces one row per
 * address. Gmail's dots-and-plus aliasing is *not* normalised, for the reason
 * `isStaffEmail` gives: `k.haleel@` reaches the same inbox as `khaleel@` but is
 * a different account, and treating them as equal would let anyone able to
 * register an alias of a staff address walk in.
 *
 * REVOKED, NOT DELETED
 * `revokedAt` is what ends access; nothing here is ever `DELETE`d. This panel
 * reads every seller's revenue and every buyer's personal data, so the question
 * that matters after an incident is "who could see this, and when did that
 * stop" — and a deleted row answers it with silence. The cost is one nullable
 * timestamp and a `WHERE revoked_at IS NULL` on the read path.
 */
export const staffMembers = pgTable(
  "staff_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /** Lowercased at every write. The thing a session's email is matched against. */
    email: text("email").notNull().unique(),

    /**
     * owner | admin | support — see `StaffRole` in `@sailo/security/staff`,
     * which is where the meaning of each lives and where `can()` reads it.
     *
     * `text` rather than a Postgres enum, matching every other status column in
     * this schema: adding a role should be a deploy, not a migration that takes
     * a lock on the table.
     *
     * Defaults to the *least* privileged role. A bug that forgets to pass a
     * role should under-grant, never over-grant.
     */
    role: text("role").$type<"owner" | "admin" | "support">().default("support").notNull(),

    /**
     * Who let them in, and who ended it. Plain text, not references — the
     * inviter may themselves be revoked later, and the record of who admitted
     * whom has to survive that. An address is what the audit question is asked
     * in anyway.
     */
    invitedByEmail: text("invited_by_email"),
    revokedByEmail: text("revoked_by_email"),

    /** Free text: "contractor, through March", "on-call only". Shown in the roster. */
    note: text("note"),

    invitedAt: timestamp("invited_at").defaultNow().notNull(),
    /** Null means active. This is the whole access check. */
    revokedAt: timestamp("revoked_at"),
    /**
     * Last time this address opened the panel. Written on a throttle rather
     * than on every request — see `touchStaffSeen` — because the alternative is
     * a write on every page view of an app made of tables.
     *
     * Exists to answer "is this account still in use", which is the question
     * behind pruning a roster that has quietly grown.
     */
    lastSeenAt: timestamp("last_seen_at"),
  },
  (t) => [
    /**
     * The roster's default view: everyone still in, most recently added first.
     * Partial, so the index holds only active members — revoked rows are kept
     * forever and would otherwise grow an index nothing queries.
     */
    index("staff_members_active_idx")
      .on(t.invitedAt)
      .where(sql`${t.revokedAt} is null`),
  ],
);
