-- Chargebacks: the record, the evidence, and the payout hold.
--
-- Additive and nullable throughout, so it is safe to apply ahead of the code
-- that reads it. Every existing shop reads as "payouts not held" and every
-- existing order as "no buyer address recorded", which is what they are.
--
-- Three parts, and the middle one is the reason for the timing:
--
--   1. `disputes`, `early_fraud_warnings`, `download_events` — new tables.
--   2. `orders.buyer_ip` and friends. These cannot be backfilled: the buyer's
--      connection existed for the length of one request. Visa's Compelling
--      Evidence 3.0 needs two matching prior transactions between 120 and 365
--      days old, so the first order that can use this data will not be able to
--      until roughly December 2026. Applying it late costs four more months.
--   3. `shops.payouts_paused_at` — deliberately not `suspended_at`. That column
--      takes a storefront off the air and is only ever written by a human. This
--      one holds a payout, is reversible with one Stripe call, and is written
--      automatically when a shop's exposure or dispute rate crosses a line.
--      Reusing the suspension column would mean a dispute rate could close a
--      shop, which is not a thing a dispute rate may do.

CREATE TABLE IF NOT EXISTS "disputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "shop_id" uuid,
  "order_id" uuid,
  "stripe_dispute_id" text NOT NULL,
  "stripe_charge_id" text,
  "stripe_payment_intent_id" text,
  "stripe_account_id" text,
  "amount_cents" integer DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "fee_cents" integer DEFAULT 0 NOT NULL,
  "deducted_cents" integer DEFAULT 0 NOT NULL,
  "funds_withdrawn_at" timestamp,
  "funds_reinstated_at" timestamp,
  "reason" text NOT NULL,
  "network_reason_code" text,
  "network" text,
  "case_type" text,
  "status" text NOT NULL,
  "due_by" timestamp,
  "stripe_created_at" timestamp NOT NULL,
  "stripe_updated_at" timestamp,
  "evidence_submitted_at" timestamp,
  "submission_count" integer DEFAULT 0 NOT NULL,
  "evidence_snapshot" jsonb,
  "completeness_bp" integer,
  "enhanced_eligibility" jsonb,
  "ce3_status" text,
  "ce3_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "disputes"
    ADD CONSTRAINT "disputes_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- `set null`, not cascade. A dispute is a fact a bank reported and it outlives
-- the row it was about: deleting the order must not erase the chargeback from
-- the shop's rate.
DO $$ BEGIN
  ALTER TABLE "disputes"
    ADD CONSTRAINT "disputes_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One row per Stripe dispute, decided by Postgres rather than by the handler.
--
-- `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn` and
-- `.funds_reinstated` all describe the same dispute under five different event
-- ids, so the `stripe_events` claim does not cover it. Without this, one
-- chargeback becomes five rows and the shop's rate is five times its real
-- value — which would hold a seller's payouts for arithmetic.
CREATE UNIQUE INDEX IF NOT EXISTS "disputes_stripe_id_key"
  ON "disputes" ("stripe_dispute_id");

CREATE INDEX IF NOT EXISTS "disputes_shop_idx" ON "disputes" ("shop_id");
CREATE INDEX IF NOT EXISTS "disputes_order_idx" ON "disputes" ("order_id");
-- The queue: everything still owing a response, soonest deadline first.
CREATE INDEX IF NOT EXISTS "disputes_status_due_idx" ON "disputes" ("status", "due_by");
-- The rate query, which starts from a shop and must never mix a seller's own
-- subscription chargeback into their storefront's rate.
CREATE INDEX IF NOT EXISTS "disputes_shop_scope_idx" ON "disputes" ("shop_id", "scope");
CREATE INDEX IF NOT EXISTS "disputes_charge_idx" ON "disputes" ("stripe_charge_id");

CREATE TABLE IF NOT EXISTS "early_fraud_warnings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid,
  "order_id" uuid,
  "stripe_warning_id" text NOT NULL,
  "stripe_charge_id" text,
  "stripe_account_id" text,
  "fraud_type" text NOT NULL,
  "actionable" text,
  "refunded_at" timestamp,
  "dispute_id" uuid,
  "stripe_created_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "early_fraud_warnings"
    ADD CONSTRAINT "efw_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "early_fraud_warnings"
    ADD CONSTRAINT "efw_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "early_fraud_warnings"
    ADD CONSTRAINT "efw_dispute_id_disputes_id_fk"
    FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "efw_stripe_id_key"
  ON "early_fraud_warnings" ("stripe_warning_id");
CREATE INDEX IF NOT EXISTS "efw_shop_idx" ON "early_fraud_warnings" ("shop_id");
CREATE INDEX IF NOT EXISTS "efw_charge_idx" ON "early_fraud_warnings" ("stripe_charge_id");

-- One row per time a buyer took a file.
--
-- `orders.download_count` is a counter, and a counter is not a log. Stripe's
-- `access_activity_log` is the whole of the evidence on a digital sale: an
-- issuer reading "downloaded 3 times" learns nothing they can weigh, while
-- three timestamped lines carrying the buyer's own purchase IP address are
-- exactly what a physical seller gets from a carrier's delivery scan.
CREATE TABLE IF NOT EXISTS "download_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "file_name" text,
  "file_id" uuid,
  "ip" text,
  "user_agent" text,
  "at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "download_events"
    ADD CONSTRAINT "download_events_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "download_events_order_at_idx"
  ON "download_events" ("order_id", "at");

-- What the buyer's browser was, so a chargeback can be answered.
--
-- Not identity and never a gate: every value is a header the client can set.
-- As evidence that is fine — an issuer is being told what we observed, not what
-- we verified — and as an access control it would be worthless.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "buyer_ip" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "buyer_user_agent" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "buyer_device_fingerprint" text;

-- The connected account, which three paths look a shop up by and none of them
-- had an index for: `account.updated` mirroring Stripe's capability changes,
-- dispute recording resolving the shop when no order matched, and the payout
-- hold reading it back. Each was a sequential scan of every shop on the
-- platform, on a path Stripe retries.
CREATE INDEX IF NOT EXISTS "shops_stripe_account_idx" ON "shops" ("stripe_account_id");

-- The payout hold, and the staff clearance that stops it re-firing.
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "payouts_paused_at" timestamp;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "payouts_paused_reason" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "payout_interval_before_hold" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "dispute_cleared_at" timestamp;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "dispute_chargebacks_at_clearance" integer;
