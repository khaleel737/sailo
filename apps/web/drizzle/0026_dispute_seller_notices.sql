-- Telling the seller a chargeback arrived.
--
-- Until this, nothing did. The dispute was recorded, the order moved, /hq lit
-- up — and the seller found out on their next visit to the payments page. The
-- response window is around twenty days and the evidence that wins a case is
-- usually a document only they have, so a seller who does not log in loses by
-- default however good the rest of the pipeline is.
--
-- These columns are what make sending idempotent, which is the whole difficulty.
-- Stripe delivers at least once and out of order, and one dispute legitimately
-- arrives under several event ids: `created`, then `updated`, then `closed`. A
-- send is therefore *claimed* with a conditional update —
--
--   update disputes set seller_opened_notified_at = now()
--   where id = $1 and seller_opened_notified_at is null returning id
--
-- — and only the caller that gets a row back sends the mail. Two webhook
-- deliveries racing produce one email, decided by Postgres rather than by
-- whichever one checked first.
--
-- Three columns and not one flag, because they are three messages a seller
-- legitimately gets for the same dispute: it arrived, the deadline is close, it
-- is over.
--
-- Additive and nullable throughout. Every dispute that already exists reads as
-- "never told", which is true — and the backfill guard below is what stops that
-- truth turning into a mailshot about cases that closed months ago.

ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "seller_opened_notified_at" timestamp;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "seller_deadline_notified_at" timestamp;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "seller_closed_notified_at" timestamp;

ALTER TABLE "early_fraud_warnings" ADD COLUMN IF NOT EXISTS "seller_notified_at" timestamp;

-- The reminder sweep's index: open disputes with a deadline nobody has been
-- nagged about. The deadline leads because it is what narrows the scan — the
-- un-nagged set is small and the table is every dispute ever recorded.
CREATE INDEX IF NOT EXISTS "disputes_deadline_reminder_idx"
  ON "disputes" ("due_by", "seller_deadline_notified_at");

-- Mark everything that already exists as already-told.
--
-- Not cosmetic. Without it the first cron tick after deploy treats every
-- historical dispute as un-notified and mails a seller about a case that closed
-- in March — which is worse than never having sent anything, because it teaches
-- them the alerts are noise before the first real one arrives.
--
-- `now()` is a lie in the sense that nobody was told then, and the honest column
-- for "we chose not to send this" does not exist and would be read by nothing.
-- The comment is the record.
UPDATE "disputes"
  SET "seller_opened_notified_at" = now(),
      "seller_deadline_notified_at" = now(),
      "seller_closed_notified_at" = now()
  WHERE "seller_opened_notified_at" IS NULL;

UPDATE "early_fraud_warnings"
  SET "seller_notified_at" = now()
  WHERE "seller_notified_at" IS NULL;
