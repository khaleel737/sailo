-- Chargeback risk management — the self-acting pass.
--
-- WHY THIS FILE EXISTS
--
-- The 2026-08-21 risk work made the escalation ladder self-acting between
-- dispute events (an hourly reassessment sweep) and taught it about early
-- fraud warnings. This is its one piece of DDL: one shop per connected
-- account, decided by Postgres — the open item docs/chargebacks.md §12 #2
-- records. Dispute attribution locates a shop by the account an event
-- arrived for, and "oldest shop wins" was a tie-break for a tie that must
-- not exist. Verified against production before writing this: zero
-- duplicates exist.
--
-- Safe to re-run: IF NOT EXISTS. CREATE UNIQUE INDEX takes a write lock for
-- its duration; on a large table run it by hand as CONCURRENTLY — the same
-- instruction 0060 and 0062 carry.

CREATE UNIQUE INDEX IF NOT EXISTS "shops_stripe_account_key"
  ON "shops" ("stripe_account_id")
  WHERE "stripe_account_id" IS NOT NULL;
