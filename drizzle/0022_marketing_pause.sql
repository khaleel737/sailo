-- Per-shop marketing send-gate: the reputation auto-pause.
--
-- Additive and nullable, so it is safe to apply ahead of the code that reads
-- it: every existing shop reads as "not paused", which is what they were.
--
-- Deliberately separate from `suspended_at`. That column takes a whole
-- storefront off the air and is only ever written by a human; this one stops
-- marketing mail and nothing else, and is written automatically when a shop's
-- bounce or complaint rate crosses a threshold.

ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "marketing_paused_at" timestamp;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "marketing_paused_reason" text;
