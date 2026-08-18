-- What a shop was, written down before it stopped being it -- and the findings
-- somebody has to look at while it is still trading.
--
-- TWO TABLES, ONE MIGRATION, BECAUSE THEY ARE ONE FEATURE
-- `shop_closures` is the record of a shop that ended; `risk_flags` is the
-- record of a decision about one that has not. They ship together because the
-- risk desk reads both -- a signup whose email digest matches a closure is a
-- flag of kind `returning_closure` -- and applying one without the other
-- leaves that path referring to a table that is not there.
--
-- WHY shop_closures EXISTS
-- Account deletion anonymises the ledger and deletes the rest: the `shops` row
-- survives to hold orders and invoices, and the name, handle, owner name, owner
-- email, products, reviews, coupons and support tickets are gone. Correct for
-- the seller who is leaving, and a blindfold for the one who is not -- take
-- deposits for a fortnight, never ship, delete the account, and the surviving
-- orders no longer say who ran the shop or what it claimed to sell. One row is
-- written before the tombstone, and it is the only thing about a closed shop
-- written to survive it.
--
-- WHAT IT KEEPS, AND WHAT IT DELIBERATELY DOES NOT
-- Every closure keeps the non-identifying shape of the business -- volume,
-- buyers, chargebacks, catalogue titles -- plus a SALTED DIGEST of the owner's
-- address, never the address. The digest answers exactly one question ("is this
-- signup the person who closed that shop?") and cannot be read, mailed or sold.
-- The readable identity is kept only when the closure happened under suspicion:
-- suspended, payouts held, open chargebacks, or closed by staff. Which of the
-- two happened is recorded in `identity_retained`, so "why do we still have
-- this person's name" has an answer on the row itself. GDPR Art. 17(3)(b) and
-- (e), Recital 47.
--
-- Safe to re-run: every statement carries IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "shop_closures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- The shop still exists -- that is the whole point of the tombstone.
  "shop_id" uuid NOT NULL,
  -- Plain text, not a reference. The "user" row survives deletion, but it
  -- survives as a tombstone, and nothing here should depend on a row whose
  -- purpose is to be emptied.
  "user_id" text NOT NULL,

  "closed_at" timestamp DEFAULT now() NOT NULL,
  -- seller | staff. Text, because a third is foreseeable: an automated closure
  -- on an unpaid balance is a different fact from either of these.
  "closed_by" text NOT NULL,
  "closed_by_email" text,
  "reason" text,

  -- none | suspicion. See the header: this is the field that records which of
  -- the two retention decisions was taken, so it can be audited later.
  "identity_retained" text DEFAULT 'none' NOT NULL,

  -- Populated only when "identity_retained" = 'suspicion'.
  "owner_name" text,
  "owner_email" text,
  "shop_name" text,
  "contact_email" text,
  "location" text,

  -- Always. Salted with a deployment secret, so a leaked copy of this table
  -- cannot be rainbow-tabled back into a mailing list.
  "owner_email_hash" text,

  -- Kept because it is what every link, screenshot and support email in the
  -- world still says, long after the handle has been released.
  "handle" text NOT NULL,

  -- The shape of the business. None of this is personal data about the seller,
  -- and all of it is what a pattern is made of.
  "currency" text NOT NULL,
  "order_count" integer DEFAULT 0 NOT NULL,
  "paid_order_count" integer DEFAULT 0 NOT NULL,
  "gross_cents" integer DEFAULT 0 NOT NULL,
  "refunded_cents" integer DEFAULT 0 NOT NULL,
  -- Paid and never delivered at the moment of closure. The buyer's loss.
  "undelivered_paid_orders" integer DEFAULT 0 NOT NULL,
  "dispute_count" integer DEFAULT 0 NOT NULL,
  "open_dispute_cents" integer DEFAULT 0 NOT NULL,
  "product_count" integer DEFAULT 0 NOT NULL,
  "buyer_count" integer DEFAULT 0 NOT NULL,
  "first_order_at" timestamp,
  "last_order_at" timestamp,
  "shop_created_at" timestamp NOT NULL,

  -- What we already thought of them.
  "suspended_at" timestamp,
  "suspended_reason" text,
  "payouts_paused_at" timestamp,
  "staff_note" text,

  -- So the trail continues where our rows stop.
  "stripe_account_id" text,
  "stripe_customer_id" text,

  -- Up to fifty [{title, kind, priceCents}], taken before the catalogue goes.
  -- Fifty rather than all: this is evidence about the CHARACTER of the shop,
  -- and rows fifty-one onwards do not change it.
  "catalogue" jsonb DEFAULT '[]'::jsonb NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "shop_closures"
    ADD CONSTRAINT "shop_closures_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The list's default order.
CREATE INDEX IF NOT EXISTS "shop_closures_closed_at_idx"
  ON "shop_closures" ("closed_at");

-- The signup-time question, which has to be cheap enough to run on a path
-- nobody is waiting on.
CREATE INDEX IF NOT EXISTS "shop_closures_email_hash_idx"
  ON "shop_closures" ("owner_email_hash");

-- Unique, because that is what makes a retried deletion an upsert rather than
-- a second row: `recordClosure` conflicts on this index, and without the
-- constraint the ON CONFLICT has nothing to target.
CREATE UNIQUE INDEX IF NOT EXISTS "shop_closures_shop_key"
  ON "shop_closures" ("shop_id");


-- ---------------------------------------------------------------------------
-- risk_flags
--
-- The risk desk derives its SIGNALS at read time from rows that already exist
-- -- chargeback rate, refund rate, velocity, whether Stripe is on, whether the
-- shop's own words trip the restricted-business screen. Deliberately: a
-- nightly job writing a row per shop per day would be a large table holding a
-- number nobody asked for on most of them.
--
-- What cannot be derived is the human half. A shop selling replica watches
-- scores the same on Tuesday as it did on Monday; the difference is that on
-- Monday somebody read it and decided. Without somewhere to write that down,
-- the desk re-presents every finding it has ever made -- which is exactly how
-- a queue teaches the people staffing it to scroll past the top of it.
--
-- Raised and cleared, never deleted, for the same reason staff_members is:
-- the most useful row in this table is a flag somebody dismissed in ninety
-- seconds and was wrong about, and it only exists if clearing is a write.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "risk_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL,

  -- chargebacks | velocity | refunds | restricted_business |
  -- returning_closure | undelivered | manual. Text, so adding a signal is a
  -- deploy and not a migration that takes a lock. Vocabulary lives in
  -- packages/core/src/risk.
  "kind" text NOT NULL,

  -- watch | review | act. Not a 0-100 score: that invites "is 61 worse than
  -- 59", which has no answer, and hides the only distinction the desk works
  -- from -- keep an eye on it, read it today, or do something now.
  "severity" text NOT NULL,

  "summary" text NOT NULL,
  -- The number it was raised on. Text because the unit differs by kind.
  "evidence" text,

  "raised_at" timestamp DEFAULT now() NOT NULL,
  -- Null when the desk raised it, which is the common case.
  "raised_by_email" text,

  -- Null means still on the desk. This is the whole open/closed check.
  "cleared_at" timestamp,
  "cleared_by_email" text,
  "cleared_reason" text,
  -- "evidence" at the moment of clearing, so re-raising compares against where
  -- somebody already looked rather than against the threshold.
  "cleared_at_value" text
);

DO $$ BEGIN
  ALTER TABLE "risk_flags"
    ADD CONSTRAINT "risk_flags_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The desk's only query: everything still open, worst first. Partial, so
-- cleared rows -- kept for ever -- stay out of an index nothing reads them
-- through.
CREATE INDEX IF NOT EXISTS "risk_flags_open_idx"
  ON "risk_flags" ("raised_at")
  WHERE "cleared_at" IS NULL;

-- One shop's history, which is what the account page shows.
CREATE INDEX IF NOT EXISTS "risk_flags_shop_idx"
  ON "risk_flags" ("shop_id", "raised_at");
