-- Spec 46 — Sailo answering a chargeback against its own subscription revenue.
--
-- `packages/db/src/schema/disputes.ts` already draws the distinction correctly:
-- a `platform` dispute is a seller charging back their own Sailo subscription,
-- Sailo's own balance is debited, and *"the remedy is a plan downgrade rather
-- than evidence about a parcel"*. That is right about the remedy and it had
-- quietly become a decision not to **defend**: `assembleEvidence` has no
-- platform branch, every field resolver reads an order, a shipment, a download
-- log or a duplicate candidate, and a subscription dispute has none of those.
-- So today a seller charges back $49, Sailo loses $49 plus a $15 fee, downgrades
-- them, and submits nothing.
--
-- ─── WHY ONE AGGREGATE TABLE AND NOT A JOIN ─────────────────────────────────
--
-- The argument that wins a `subscription_canceled` is *use after the claimed
-- cancellation date*, and the raw sources for it are on three different
-- retention clocks: `visit_daily` is analytics and gets swept, `account_events`
-- (spec 44) is kept 400 days, orders are permanent. An evidence claim must not
-- depend on a table that empties itself — the same problem that makes
-- better-auth's `session` unusable here and the reason spec 44 added
-- `account_events` at all.
--
-- ─── AND WHY A MISSING DAY IS NOT A ZERO ────────────────────────────────────
--
-- `rolled_up_at` is the difference between "they did not use the service" and
-- "the rollup did not run". A day with no row is a gap and is labelled as one; a
-- day with a row and zeroes is a real zero. Submitting a false zero argues our
-- own case against us, in front of an issuer, on Sailo's own account.

CREATE TABLE IF NOT EXISTS "platform_usage_daily" (
  "shop_id"           uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "day"               date NOT NULL,

  "signins"           integer NOT NULL DEFAULT 0,
  "orders_processed"  integer NOT NULL DEFAULT 0,
  "products_active"   integer NOT NULL DEFAULT 0,
  "emails_sent"       integer NOT NULL DEFAULT 0,
  "storefront_views"  integer NOT NULL DEFAULT 0,
  "admin_actions"     integer NOT NULL DEFAULT 0,

  -- When the rollup wrote this row. Its absence is what makes a gap a gap.
  "rolled_up_at"      timestamp NOT NULL DEFAULT now(),

  PRIMARY KEY ("shop_id", "day")
);

-- The evidence read: one shop, a date range, in order.
CREATE INDEX IF NOT EXISTS "platform_usage_shop_day_idx"
  ON "platform_usage_daily" ("shop_id", "day");

-- ─── Telling staff, on the same claim shape that tells a seller ─────────────
--
-- The three `seller*NotifiedAt` columns are for telling a *seller* about their
-- dispute. A platform dispute needs the opposite — tell **staff** — and reusing
-- those columns would make one mean two things depending on `scope`, which is
-- the shape of bug that silently stops notifying somebody. Same conditional-
-- update claim, different columns.

ALTER TABLE "disputes"
  ADD COLUMN IF NOT EXISTS "staff_notified_at" timestamp,
  ADD COLUMN IF NOT EXISTS "staff_deadline_notified_at" timestamp;

-- ─── The remedy, held rather than fired ─────────────────────────────────────
--
-- The existing downgrade on a lost platform dispute is correct and keeps
-- working. Contesting and downgrading are not exclusive: the downgrade is held
-- while the case is open where the deadline allows, and a win reinstates the
-- plan. `plan_before_dispute` is what "reinstate" restores — without it a win
-- would put the shop back on whatever the code guessed rather than what they
-- were paying for.
ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "plan_before_dispute" text;

-- ─── Repeat offenders ───────────────────────────────────────────────────────
--
-- A second platform chargeback from one customer means the card rail is closed
-- to them: a normal risk control, and the same graded shape `payouts_paused_at`
-- and `suspended_at` already use. Nothing else is offered — this is not a
-- suspension, the shop keeps trading, they simply stop being able to pay Sailo
-- by card.
ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "card_billing_blocked_at" timestamp,
  ADD COLUMN IF NOT EXISTS "card_billing_blocked_reason" text;

-- The staff deadline sweep, the platform-side twin of
-- `disputes_deadline_reminder_idx`. Partial on scope because platform disputes
-- are a tiny minority of the table and this index exists only for them.
CREATE INDEX IF NOT EXISTS "disputes_platform_deadline_idx"
  ON "disputes" ("due_by", "staff_deadline_notified_at")
  WHERE "scope" = 'platform';
