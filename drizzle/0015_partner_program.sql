-- The partner programme: anyone with an audience can bring Sailo creators and
-- keep 30% of what those creators pay us, for as long as they keep paying.
--
-- This supersedes the shop-to-shop version added in 0012. The change that
-- matters is the identity: a referrer used to *be* a shop, which meant only
-- sellers could refer. The people who actually drive referral volume —
-- newsletter writers, YouTubers, agencies — are frequently not sellers and
-- never will be, so a partner is now its own row with its own Stripe account,
-- optionally linked to a shop.
--
-- Everything in 0012 is preserved: the ledger is repointed, not rebuilt, and
-- the backfill below mints one partner per shop that had already referred
-- somebody so no earning loses its owner.

/* -------------------------------------------------------------------------- */
/*  The partner                                                                */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS "partners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "shop_id" uuid REFERENCES "shops"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'pending' NOT NULL,

  "name" text NOT NULL,
  "website" text,
  "audience" text,
  "pitch" text,

  "code" text,
  "commission_bp" integer,

  -- A `recipient` connected account: receives transfers, cannot take payments.
  "stripe_account_id" text,
  "stripe_transfers_enabled" boolean DEFAULT false NOT NULL,
  "stripe_details_submitted" boolean DEFAULT false NOT NULL,
  "stripe_account_country" text,
  "stripe_connected_at" timestamp,

  "applied_at" timestamp DEFAULT now() NOT NULL,
  "reviewed_at" timestamp,
  "reviewed_by" text,
  "review_note" text,
  "notes" text,

  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,

  -- An approved partner must have a code. One-directional on purpose: the
  -- converse would force suspension to null the column, and a partner
  -- reinstated a fortnight later would come back with a different code than
  -- the one already printed in their newsletter. Suspended partners keep their
  -- code and stop earning by status instead.
  CONSTRAINT "partners_approved_has_code"
    CHECK ("status" <> 'approved' OR "code" IS NOT NULL),
  CONSTRAINT "partners_commission_bp_range"
    CHECK ("commission_bp" IS NULL
           OR ("commission_bp" >= 0 AND "commission_bp" <= 10000))
);

CREATE UNIQUE INDEX IF NOT EXISTS "partners_user_key" ON "partners" ("user_id");
-- NULLs are distinct in Postgres, so every applicant still awaiting a decision
-- coexists here without a partial-index clause.
CREATE UNIQUE INDEX IF NOT EXISTS "partners_code_key" ON "partners" ("code");
CREATE INDEX IF NOT EXISTS "partners_status_idx" ON "partners" ("status");
CREATE INDEX IF NOT EXISTS "partners_shop_idx" ON "partners" ("shop_id");

/* -------------------------------------------------------------------------- */
/*  Payouts                                                                    */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS "partner_payouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "partner_id" uuid NOT NULL REFERENCES "partners"("id") ON DELETE CASCADE,
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "stripe_transfer_id" text,
  "idempotency_key" text NOT NULL,
  "failure_reason" text,
  "initiated_by" text DEFAULT 'auto' NOT NULL,
  "initiated_by_email" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "paid_at" timestamp,
  CONSTRAINT "partner_payouts_amount_positive" CHECK ("amount_cents" > 0)
);

-- The row is written before Stripe is called and carries the key we will send,
-- so a retry after a timeout reuses it and cannot become a second transfer.
CREATE UNIQUE INDEX IF NOT EXISTS "partner_payouts_idempotency_key"
  ON "partner_payouts" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "partner_payouts_transfer_key"
  ON "partner_payouts" ("stripe_transfer_id");
CREATE INDEX IF NOT EXISTS "partner_payouts_partner_idx"
  ON "partner_payouts" ("partner_id");
CREATE INDEX IF NOT EXISTS "partner_payouts_status_idx"
  ON "partner_payouts" ("status");

/* -------------------------------------------------------------------------- */
/*  Repointing attribution at the partner                                      */
/* -------------------------------------------------------------------------- */

ALTER TABLE "creator_referrals" ADD COLUMN IF NOT EXISTS "partner_id" uuid;

-- One partner per shop that had already referred somebody under 0012.
--
-- Approved on sight and given the shop's existing code, because that code is
-- already in circulation: anything else would break links people have posted.
-- `ON CONFLICT DO NOTHING` makes the whole migration re-runnable.
INSERT INTO "partners" ("user_id", "shop_id", "status", "name", "code", "applied_at", "reviewed_at", "reviewed_by", "review_note")
SELECT DISTINCT ON (s."user_id")
       s."user_id",
       s."id",
       'approved',
       s."name",
       -- A referrer with no minted code cannot exist (the code is how they were
       -- found), but coalesce keeps the approved-has-code check satisfiable.
       COALESCE(s."referral_code", cr."code"),
       now(), now(), 'migration 0013',
       'Migrated from the shop-to-shop referral programme.'
FROM "creator_referrals" cr
JOIN "shops" s ON s."id" = cr."referrer_shop_id"
ORDER BY s."user_id", cr."attributed_at"
ON CONFLICT ("user_id") DO NOTHING;

UPDATE "creator_referrals" cr
SET "partner_id" = p."id"
FROM "shops" s
JOIN "partners" p ON p."shop_id" = s."id"
WHERE cr."referrer_shop_id" = s."id"
  AND cr."partner_id" IS NULL;

-- Any row the backfill could not place (a referrer shop that was hard-deleted)
-- has no owner to pay, so it is dropped rather than left dangling.
DELETE FROM "creator_referrals" WHERE "partner_id" IS NULL;

ALTER TABLE "creator_referrals" ALTER COLUMN "partner_id" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "creator_referrals"
    ADD CONSTRAINT "creator_referrals_partner_id_fk"
    FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "creator_referrals_partner_idx"
  ON "creator_referrals" ("partner_id");

-- The old shape goes, along with the self-referral check it was the subject of.
-- Self-referral is now "the partner's own shop is the referred shop", which is
-- enforced in `attributeReferral` against `partners.shop_id` and the applicant's
-- email; there is no single column pair left for a CHECK to compare.
ALTER TABLE "creator_referrals" DROP CONSTRAINT IF EXISTS "creator_referrals_not_self";
DROP INDEX IF EXISTS "creator_referrals_referrer_idx";
ALTER TABLE "creator_referrals" DROP COLUMN IF EXISTS "referrer_shop_id";

/* -------------------------------------------------------------------------- */
/*  The ledger learns its rate, its hold and its payout                        */
/* -------------------------------------------------------------------------- */

-- 2000 for anything already written: those rows were earned under the 20%
-- programme and must keep saying so. New rows carry whatever rate was in force
-- when they were computed.
ALTER TABLE "referral_earnings"
  ADD COLUMN IF NOT EXISTS "commission_bp" integer DEFAULT 2000 NOT NULL;
ALTER TABLE "referral_earnings" ALTER COLUMN "commission_bp" DROP DEFAULT;

-- Existing rows are long past any hold, so they mature when they were created.
ALTER TABLE "referral_earnings"
  ADD COLUMN IF NOT EXISTS "mature_at" timestamp DEFAULT now() NOT NULL;
UPDATE "referral_earnings" SET "mature_at" = "created_at" WHERE "mature_at" > "created_at";

ALTER TABLE "referral_earnings" ADD COLUMN IF NOT EXISTS "payout_id" uuid;

DO $$ BEGIN
  ALTER TABLE "referral_earnings"
    ADD CONSTRAINT "referral_earnings_payout_id_fk"
    FOREIGN KEY ("payout_id") REFERENCES "partner_payouts"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "referral_earnings_payout_idx"
  ON "referral_earnings" ("payout_id");

-- The payout run asks one question of this table: what is unpaid and out of
-- hold. The old single-column index answered half of it.
DROP INDEX IF EXISTS "referral_earnings_unpaid_idx";
CREATE INDEX IF NOT EXISTS "referral_earnings_unpaid_idx"
  ON "referral_earnings" ("paid_out_at", "mature_at");

/* -------------------------------------------------------------------------- */
/*  Programme settings                                                         */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS "partner_program_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "accepting_applications" boolean DEFAULT true NOT NULL,
  "auto_approve_sellers" boolean DEFAULT true NOT NULL,
  "commission_bp" integer DEFAULT 3000 NOT NULL,
  "payout_minimum_cents" integer DEFAULT 2500 NOT NULL,
  "cookie_days" integer DEFAULT 90 NOT NULL,
  "hold_days" integer DEFAULT 30 NOT NULL,
  "auto_payout" boolean DEFAULT true NOT NULL,
  "payout_day_of_month" integer DEFAULT 1 NOT NULL,
  "terms" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" text,
  -- Settings that can exist twice are settings that disagree.
  CONSTRAINT "partner_program_settings_singleton" CHECK ("id" = 1),
  CONSTRAINT "partner_program_settings_commission_bp_range"
    CHECK ("commission_bp" >= 0 AND "commission_bp" <= 10000),
  CONSTRAINT "partner_program_settings_payout_day_range"
    CHECK ("payout_day_of_month" >= 1 AND "payout_day_of_month" <= 28),
  CONSTRAINT "partner_program_settings_non_negative"
    CHECK ("payout_minimum_cents" >= 0 AND "cookie_days" >= 0 AND "hold_days" >= 0)
);

INSERT INTO "partner_program_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;

-- `shops.referral_code` is now a partner's code and lives on `partners`. The
-- column is left in place, unread, so this migration stays reversible; the
-- backfill above copied every live value across.
