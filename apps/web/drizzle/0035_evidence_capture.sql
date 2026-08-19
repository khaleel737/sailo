-- Spec 44 — the five things a chargeback is answered with that we were not
-- recording.
--
-- Every column here is nullable and every table is new, so an existing shop
-- reads and sells identically the moment this lands. Nothing in this file
-- changes a behaviour; it only gives five facts somewhere to live.
--
-- WHY THIS ONE SHIPS FIRST, AND ALONE
--
-- None of it can be backfilled. A dispute arrives up to 120 days after the sale,
-- and Visa's CE3.0 wants two matching transactions between 120 and 365 days old
-- — so the value of a row written today is realised next spring, and every week
-- this waits is a week of orders that can never be defended.
-- `packages/core/src/disputes/ce3.ts` already makes the argument about
-- `orders.buyer_ip`; it applies with full force to all five below.
--
--   1. STATEMENT DESCRIPTOR   what the buyer saw on their statement. The cause
--                             of `unrecognized` (Visa 10.4 / MC 4837), and
--                             `statement_descriptor` matched zero files in this
--                             tree before now. Snapshotted onto the order,
--                             because a seller who edits theirs next month must
--                             not change what a five-month-old dispute claims.
--
--   2. POLICY SNAPSHOTS       what they agreed to. `orders.terms_accepted_at`
--                             recorded *when*; nothing recorded *what*, and
--                             `shops.terms_url` is a URL the seller can change —
--                             an issuer following it today reads today's policy.
--                             Content-addressed, so a shop with a stable policy
--                             has one row for its whole life.
--
--   3. ORDER MESSAGES         every message sent to the buyer, as sent. Stripe's
--                             `customer_communication` slot asked the *seller*
--                             to upload messages that Sailo itself had sent and
--                             not kept.
--
--   4. DELIVERY CONFIRMATION  `shipped` is not `delivered`, and
--                             `docs/chargebacks.md` says so in as many words:
--                             "a tracking number showing 'in transit' is not
--                             delivery". Deliberately NOT a new order status —
--                             three surfaces render status and the enum's header
--                             records what happened last time a copy drifted.
--
--   5. ACCOUNT EVENTS         a sign-in history that outlives a session.
--                             better-auth's `session` carries exactly the right
--                             evidence and then deletes it on expiry, so spec 46
--                             cannot be built on it.
--
-- RETENTION: 400 days for the three new tables, and deliberately outside the
-- analytics retention sweep. `download_events` already draws that distinction —
-- these answer a bank, they are not aggregated by anybody.

-- ─── 1. Statement descriptor ────────────────────────────────────────────────

ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "statement_descriptor" text,
  ADD COLUMN IF NOT EXISTS "statement_descriptor_suffix" text;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "statement_descriptor" text;

-- ─── 2. Policy snapshots ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "policy_snapshots" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL means Sailo's own terms, snapshotted on deploy. Spec 46 answers a
  -- seller's subscription chargeback partly with the terms they accepted at
  -- signup, and a link to a page that has since changed is no better as our
  -- evidence than a changed URL is as a seller's.
  "shop_id"      uuid REFERENCES "shops"("id") ON DELETE CASCADE,
  "kind"         text NOT NULL,
  "content_hash" text NOT NULL,
  "body"         text NOT NULL,
  "source"       text,
  "source_url"   text,
  "captured_at"  timestamp NOT NULL DEFAULT now()
);

-- Two unique indexes rather than one, and this is not a stylistic choice.
-- Postgres treats NULLs as distinct, so a single index over
-- (shop_id, kind, content_hash) would let every deploy insert Sailo's own terms
-- again — NULL never equals NULL, so the conflict never fires.
CREATE UNIQUE INDEX IF NOT EXISTS "policy_snapshots_shop_kind_hash_key"
  ON "policy_snapshots" ("shop_id", "kind", "content_hash")
  WHERE "shop_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "policy_snapshots_platform_kind_hash_key"
  ON "policy_snapshots" ("kind", "content_hash")
  WHERE "shop_id" IS NULL;

CREATE INDEX IF NOT EXISTS "policy_snapshots_shop_kind_idx"
  ON "policy_snapshots" ("shop_id", "kind", "captured_at");

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "terms_snapshot_id" uuid,
  ADD COLUMN IF NOT EXISTS "refund_snapshot_id" uuid;

-- `set null`, not cascade. A snapshot is never deleted; if one ever is, the
-- order has to survive it and the readiness panel reports the policy as
-- `missing`, which is the truth. A page that failed to load would not be.
DO $$ BEGIN
  ALTER TABLE "orders"
    ADD CONSTRAINT "orders_terms_snapshot_id_policy_snapshots_id_fk"
    FOREIGN KEY ("terms_snapshot_id") REFERENCES "policy_snapshots"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "orders"
    ADD CONSTRAINT "orders_refund_snapshot_id_policy_snapshots_id_fk"
    FOREIGN KEY ("refund_snapshot_id") REFERENCES "policy_snapshots"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. Per-order communications log ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "order_messages" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id"            uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "shop_id"             uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "kind"                text NOT NULL,
  "direction"           text NOT NULL DEFAULT 'outbound',
  "to_address"          text,
  "subject"             text,
  -- As sent, never a template id. The template changes; what the buyer read
  -- does not, and it is what the buyer read that answers an issuer.
  "body_text"           text,
  "provider_message_id" text,
  "status"              text,
  "sent_at"             timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "order_messages_order_idx"
  ON "order_messages" ("order_id", "sent_at");

CREATE INDEX IF NOT EXISTS "order_messages_shop_idx"
  ON "order_messages" ("shop_id", "sent_at");

-- The bounce webhook arrives with a provider id and nothing else, so this is the
-- only way back to the row. Partial, because most rows never get one and an
-- index over mostly-NULL is mostly waste.
CREATE INDEX IF NOT EXISTS "order_messages_provider_idx"
  ON "order_messages" ("provider_message_id")
  WHERE "provider_message_id" IS NOT NULL;

-- ─── 4. Delivery confirmation ───────────────────────────────────────────────

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "delivered_at" timestamp,
  ADD COLUMN IF NOT EXISTS "delivered_source" text,
  ADD COLUMN IF NOT EXISTS "delivery_signed_by" text;

-- The nudge, and the pack's own lookup: a shipped physical order that has not
-- been confirmed as arrived. Partial on both sides so it stays small — the set
-- worth chasing is the one that has been sent and not yet landed.
CREATE INDEX IF NOT EXISTS "orders_shipped_undelivered_idx"
  ON "orders" ("shop_id", "shipped_at")
  WHERE "shipped_at" IS NOT NULL AND "delivered_at" IS NULL;

-- ─── 5. Durable account events ──────────────────────────────────────────────

-- `user_id` carries no foreign key deliberately. Account deletion (spec 03)
-- retains the ledger and these rows are part of it: a chargeback from somebody
-- who has since closed their account is exactly the case that still needs
-- answering, and a cascade would delete the answer.
CREATE TABLE IF NOT EXISTS "account_events" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"    text NOT NULL,
  "shop_id"    uuid REFERENCES "shops"("id") ON DELETE SET NULL,
  "kind"       text NOT NULL,
  "ip"         text,
  "user_agent" text,
  "city"       text,
  "country"    text,
  "detail"     jsonb,
  "at"         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "account_events_user_idx"
  ON "account_events" ("user_id", "at");

CREATE INDEX IF NOT EXISTS "account_events_shop_kind_idx"
  ON "account_events" ("shop_id", "kind", "at");
