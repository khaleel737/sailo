-- Email reputation enforcement — the clearance watermark.
--
-- WHY THIS FILE EXISTS
--
-- 0022 gave shops an automatic marketing pause when the rolling complaint or
-- bounce rate crosses the line. Clearing it was a plain NULL-out, which made
-- staff resolution a no-op while old events trickled in: a webhook arriving
-- late for a send that predated the clearance re-ran the same 30-day window
-- and re-paused the shop within the minute. `marketing_cleared_at` is the
-- adjudication watermark — the reputation window starts no earlier than it,
-- so clearance settles the past while new sends still count in full.
--
-- Safe to re-run: IF NOT EXISTS / additive only.

ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "marketing_cleared_at" timestamp;
