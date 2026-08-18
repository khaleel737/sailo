-- Who works at Sailo, and what they are allowed to do in the staff panel.
--
-- Replaces SAILO_STAFF_EMAILS as the roster. That variable still admits, but
-- only as break-glass for an environment whose table is empty or missing --
-- see `staffEmails()` in packages/security/src/staff.ts. The order is: this
-- table first, the variable only when this table has no row for the address.
-- Never the other way round, or revoking someone listed in the variable would
-- silently do nothing.
--
-- The email is the identity and there is deliberately no foreign key to
-- "user". A member is invited before they have an account: the invite writes
-- the row here, and better-auth creates the "user" row when they click the
-- link mailed to them. A reference would make the ordinary case impossible.
--
-- Nothing here is ever deleted. `revoked_at` is what ends access, because the
-- question after an incident is "who could see this, and when did that stop",
-- and a deleted row answers it with silence.
--
-- Safe to re-run: every statement carries IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "staff_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Lowercased at every write. UNIQUE is what makes a mixed-case invite and a
  -- lowercase session land on the same row.
  "email" text NOT NULL UNIQUE,
  -- owner | admin | support. Text rather than an enum, matching every other
  -- status column in this schema: adding a role should be a deploy, not a
  -- migration that takes a lock. Defaults to the LEAST privileged role, so a
  -- bug that forgets to pass one under-grants.
  "role" text DEFAULT 'support' NOT NULL,
  -- Who admitted them, and who ended it. Plain text, not references: the
  -- inviter may themselves be revoked later and this record has to survive it.
  "invited_by_email" text,
  "revoked_by_email" text,
  -- "contractor, through March". Shown in the roster.
  "note" text,
  "invited_at" timestamp DEFAULT now() NOT NULL,
  -- Null means active. This is the whole access check.
  "revoked_at" timestamp,
  -- Written on a 15-minute throttle, not per request; this app is made of
  -- tables and the untrottled version would make the roster the most-written
  -- row in the database to record something nobody reads that finely.
  "last_seen_at" timestamp
);

-- The roster's default view: everyone still in, most recently added first.
-- Partial, so revoked rows -- which are kept forever -- stay out of an index
-- that nothing queries them through.
CREATE INDEX IF NOT EXISTS "staff_members_active_idx"
  ON "staff_members" ("invited_at")
  WHERE "revoked_at" IS NULL;
