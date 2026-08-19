-- Spec 37 — the people a seller works with, and what each of them may do.
--
-- WHAT IS NOT HERE
--
-- No `shop_roles`, no `shop_members`, no invitation token, no expiry, no
-- acceptance flow. `better-auth/plugins/organization` ships all of it, tested
-- upstream, and it is the half most easily got subtly wrong by hand — an invite
-- token with no expiry, a revoked member whose session outlives the revocation.
-- The three tables below are the plugin's own shapes, read from its schema
-- declaration, created here because `db:push` cannot express the backfill.
--
-- `team` and `teamMember` are deliberately absent. The plugin offers sub-teams
-- inside an organization; a Sailo shop is one team, and an unused concept costs
-- more than an unused table would save.
--
-- THE BACKFILL IS THE POINT OF THIS FILE
--
-- Every existing shop gets an organization whose only member is its current
-- owner. Without it a shop would exist with nobody able to administer it, and
-- there is no support path back from that which does not involve somebody at
-- Sailo editing rows by hand.
--
-- `shops.user_id` stays the owner of record and nothing here changes it. It is
-- what account deletion (spec 03), the closure record and every existing
-- ownership check already read; re-pointing all of that at membership would be
-- a second tree-wide change for no gain. The organization decides who *else*
-- may act; `user_id` still decides whose shop it is.
--
-- Ids are `text`, not `uuid`: better-auth generates its own and the adapter
-- hands them over as strings. `gen_random_uuid()::text` in the backfill matches
-- what the library would have produced closely enough for rows it will only
-- ever read back by id.
--
-- Safe to re-run. The backfill is guarded by `WHERE organization_id IS NULL`
-- and by `ON CONFLICT DO NOTHING`, so a second pass changes nothing.

CREATE TABLE IF NOT EXISTS "organization" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "logo" text,
  "metadata" text,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_slug_key" ON "organization" ("slug");

CREATE TABLE IF NOT EXISTS "member" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role" text DEFAULT 'member' NOT NULL,
  "created_at" timestamp NOT NULL
);

-- The lookup every guarded request makes: this user, in this shop's
-- organization, with what role. Without it `requireShop` reads the whole table
-- on every page of every admin screen.
CREATE INDEX IF NOT EXISTS "member_user_org_idx" ON "member" ("user_id", "organization_id");
-- One membership per person per shop. Two rows would make "their role" a
-- question with two answers, decided by whichever the query returned first.
CREATE UNIQUE INDEX IF NOT EXISTS "member_org_user_key" ON "member" ("organization_id", "user_id");

CREATE TABLE IF NOT EXISTS "invitation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL,
  "inviter_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "invitation_org_idx" ON "invitation" ("organization_id", "status");

ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "organization_id" text;

-- Who did what, once a shop has more than one person in it.
--
-- `actor_email` and not a user id: the record has to survive the account. A
-- person removed from the team — or one who deleted their Sailo account — still
-- did the thing, and a foreign key would either cascade the history away or
-- block the deletion.
CREATE TABLE IF NOT EXISTS "shop_member_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "actor_email" text NOT NULL,
  "actor_role" text,
  "action" text NOT NULL,
  "subject_type" text,
  "subject_id" text,
  "detail" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "shop_member_actions_shop_created_idx"
  ON "shop_member_actions" ("shop_id", "created_at");

-- ---------------------------------------------------------------------------
-- The backfill. Every existing shop, its own organization, its owner inside it.
-- ---------------------------------------------------------------------------

INSERT INTO "organization" ("id", "name", "slug", "created_at")
SELECT gen_random_uuid()::text, s."name", 'shop-' || s."id"::text, now()
FROM "shops" s
WHERE s."organization_id" IS NULL
ON CONFLICT ("slug") DO NOTHING;

UPDATE "shops" s
SET "organization_id" = o."id"
FROM "organization" o
WHERE o."slug" = 'shop-' || s."id"::text
  AND s."organization_id" IS NULL;

INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at")
SELECT gen_random_uuid()::text, s."organization_id", s."user_id", 'owner', now()
FROM "shops" s
WHERE s."organization_id" IS NOT NULL
ON CONFLICT ("organization_id", "user_id") DO NOTHING;
