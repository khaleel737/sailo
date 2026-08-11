-- Refer-a-creator: a seller earns 20% of what the seller they brought in
-- pays Sailo, for as long as that subscription runs (spec 13).
--
-- Three shapes matter here, and all three are constraints rather than
-- application rules, because a referral programme is a thing people attack
-- and application rules are one refactor away from not running:
--
--   1. `creator_referrals_referred_key` is first-touch attribution. A shop has
--      at most one referrer, ever. Two links arriving at the same signup
--      cannot both win, and a later link cannot overwrite an earlier one.
--   2. `creator_referrals_not_self` refuses a shop referring itself. The
--      application checks the owner's email as well; this is the floor under
--      that check.
--   3. `referral_earnings_invoice_kind_key` is webhook idempotency. Stripe
--      delivers at least once; the second `invoice.paid` for the same invoice
--      adds nothing. Keyed on (invoice, kind) rather than invoice alone so a
--      refund can append its reversal against the same invoice id.
--
-- The ledger is append-only. Nothing updates an amount; `paid_out_at` is a
-- stamp, so a balance is always a sum of rows rather than a number somebody
-- overwrote.

ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "referral_code" text;

-- NULLs are distinct in Postgres, so every shop that never mints a code
-- coexists here without a partial-index clause.
CREATE UNIQUE INDEX IF NOT EXISTS "shops_referral_code_key"
  ON "shops" ("referral_code");

CREATE TABLE IF NOT EXISTS "creator_referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "referrer_shop_id" uuid NOT NULL
    REFERENCES "shops"("id") ON DELETE CASCADE,
  "referred_shop_id" uuid NOT NULL
    REFERENCES "shops"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "attributed_at" timestamp DEFAULT now() NOT NULL,
  "converted_at" timestamp,
  CONSTRAINT "creator_referrals_not_self"
    CHECK ("referrer_shop_id" <> "referred_shop_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "creator_referrals_referred_key"
  ON "creator_referrals" ("referred_shop_id");
CREATE INDEX IF NOT EXISTS "creator_referrals_referrer_idx"
  ON "creator_referrals" ("referrer_shop_id");

CREATE TABLE IF NOT EXISTS "referral_earnings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "referral_id" uuid NOT NULL
    REFERENCES "creator_referrals"("id") ON DELETE CASCADE,
  "stripe_invoice_id" text NOT NULL,
  "kind" text DEFAULT 'earning' NOT NULL,
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "paid_out_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_earnings_invoice_kind_key"
  ON "referral_earnings" ("stripe_invoice_id", "kind");
CREATE INDEX IF NOT EXISTS "referral_earnings_referral_idx"
  ON "referral_earnings" ("referral_id");
CREATE INDEX IF NOT EXISTS "referral_earnings_unpaid_idx"
  ON "referral_earnings" ("paid_out_at");
