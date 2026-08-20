-- The `checkout.abandoned` flow trigger's claim stamp — spec 30 meets spec 32.
--
-- `flow_enrolled_at` records that a session's abandonment was announced to the
-- automations engine, exactly once, claimed by a conditional UPDATE the same
-- way `recovery_sent_at` guards the built-in email. Its own column and not a
-- reuse of that one: the built-in recovery email and a seller's own flow are
-- separate decisions, and a shop with recovery switched off still gets its
-- flows enrolled.
--
-- PRODUCTION NOTE — the same instruction 0033 and 0060 carry: ADD COLUMN is
-- instant, but run the CREATE INDEX by hand as CREATE INDEX CONCURRENTLY,
-- outside a transaction, before applying this file plainly. Written without
-- CONCURRENTLY so db:push and a fresh environment can run it as-is.

ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "flow_enrolled_at" timestamp;

CREATE INDEX IF NOT EXISTS "checkout_sessions_flow_due_idx"
  ON "checkout_sessions" ("opened_at")
  WHERE "status" IN ('opened', 'error') AND "flow_enrolled_at" IS NULL AND "order_id" IS NULL;
