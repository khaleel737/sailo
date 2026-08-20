-- Indexes for the reads the 2026-08-20 load audit found paying full price.
--
-- WHY THIS FILE EXISTS
--
-- 0060 gave every `/api/v1`-listed table its `(shop_id, created_at, id)`
-- keyset index — and skipped `orders`, the highest-write table of the set.
-- This file closes that gap and the rest of the audit's index findings: the
-- dashboard's open-tail read, the status tabs, the affiliate probes, the
-- email filter, the funnel's session count, the flows tile, the better-auth
-- FKs that never had an index, and a retention path for `stripe_events`.
--
-- Safe to re-run: every statement is IF [NOT] EXISTS.
--
-- Note for whoever applies this: CREATE INDEX takes a write lock for its
-- duration. On a large table run each of these by hand as CREATE INDEX
-- CONCURRENTLY, which cannot run inside a transaction block — the same
-- instruction 0033 and 0060 carry, for the same reason. They are written
-- plainly here because that is what `drizzle-kit push` and a fresh
-- environment can both run.

-- ---------------------------------------------------------------------------
-- orders — the keyset 0060 skipped, and the shapes the admin actually reads
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "orders_shop_keyset_idx"
  ON "orders" ("shop_id", "created_at", "id");

-- Strict prefixes of the keyset index above; keeping them is pure write
-- amplification on the hottest table. Drop AFTER the keyset index exists.
DROP INDEX IF EXISTS "orders_shop_created_idx";
DROP INDEX IF EXISTS "orders_shop_idx";

-- The dashboard's open tail: undecided orders plus unpaid commission. The
-- companion predicate change in @sailo/analytics/dashboard narrows the
-- commission disjunct to orders that actually carry one — without it,
-- `commission_paid = false` matched every order a no-affiliate shop ever took.
CREATE INDEX IF NOT EXISTS "orders_open_tail_idx"
  ON "orders" ("shop_id")
  WHERE "status" in ('new', 'confirmed')
     OR "payment_status" = 'pending'
     OR ("commission_cents" > 0 AND NOT "commission_paid");

-- The orders page's status tabs: count(*) group by status, per view.
CREATE INDEX IF NOT EXISTS "orders_shop_status_idx"
  ON "orders" ("shop_id", "status");

-- The affiliate ledgers probe orders by affiliate; almost no order has one.
CREATE INDEX IF NOT EXISTS "orders_affiliate_idx"
  ON "orders" ("affiliate_id")
  WHERE "affiliate_id" IS NOT NULL;

-- GET /api/v1/orders?email= — clients got this expression index in 0016.
CREATE INDEX IF NOT EXISTS "orders_shop_email_lower_idx"
  ON "orders" ("shop_id", lower("customer_email"));

-- ---------------------------------------------------------------------------
-- The dashboard's other per-load reads
-- ---------------------------------------------------------------------------

-- The expansion tile: "this shop, entered since". (shop_id, email) serves the
-- equality but heap-fetches the shop's lifetime run history to test the date.
CREATE INDEX IF NOT EXISTS "automation_runs_shop_entered_idx"
  ON "automation_runs" ("shop_id", "entered_at");

-- The conversion funnel counts sessions with no status pin; `status` in the
-- middle of the existing (shop_id, status, opened_at) blocks the range.
CREATE INDEX IF NOT EXISTS "checkout_sessions_shop_opened_idx"
  ON "checkout_sessions" ("shop_id", "opened_at");

-- ---------------------------------------------------------------------------
-- better-auth tables — the FKs that never had an index
-- ---------------------------------------------------------------------------

-- HQ lists and revokes sessions by user; user deletion cascades through both.
-- `two_factor` got its user index in 0008; these tables simply never did.
CREATE INDEX IF NOT EXISTS "session_user_idx" ON "session" ("user_id");
CREATE INDEX IF NOT EXISTS "account_user_idx" ON "account" ("user_id");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx"
  ON "verification" ("identifier");

-- ---------------------------------------------------------------------------
-- Platform-wide sorts and retention
-- ---------------------------------------------------------------------------

-- HQ's platform products list sorts newest-first across all shops; every
-- other products index is shop-prefixed.
CREATE INDEX IF NOT EXISTS "products_created_idx" ON "products" ("created_at");

-- The idempotency ledger grows forever otherwise; Stripe never redelivers an
-- event past a few days, so the sweep cron now prunes by processed_at.
CREATE INDEX IF NOT EXISTS "stripe_events_processed_idx"
  ON "stripe_events" ("processed_at");
