-- Two appointments that overlap are as double-booked as two that start
-- together, and the unique index on `(product_id, starts_at)` only caught the
-- second kind.
--
-- A shop can set `booking_slot_minutes` shorter than a service's
-- `duration_minutes` — a 60-minute service offered on the half hour — so
-- 09:00–10:00 and 09:30–10:30 are both offerable starts. Sequentially the slot
-- generator excludes the second, because `busy_for` returns intervals and it
-- compares against them. Concurrently, two checkouts each inserted a claim
-- with a different `starts_at` and both were allowed.
--
-- An exclusion constraint is the tool for exactly this: it is a unique index
-- whose notion of "already taken" is `overlaps` rather than `equals`. Postgres
-- enforces it in the same statement, so the second insert loses the way the
-- second identical one already did.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- The end of the appointment. Backfilled from each product's duration, and
-- defaulted to the start so a row can never carry a null range.
ALTER TABLE "booking_claims"
  ADD COLUMN IF NOT EXISTS "ends_at" timestamp;

UPDATE "booking_claims" c
SET "ends_at" = c."starts_at" + make_interval(mins => COALESCE(p."duration_minutes", 0))
FROM "products" p
WHERE p."id" = c."product_id" AND c."ends_at" IS NULL;

-- Anything left has no product row to read a duration from; a zero-length
-- range still collides with an identical start, which is the old guarantee.
UPDATE "booking_claims" SET "ends_at" = "starts_at" WHERE "ends_at" IS NULL;

ALTER TABLE "booking_claims" ALTER COLUMN "ends_at" SET NOT NULL;

/*
 * `[)` — half-open, so an appointment ending at 10:00 does not collide with
 * one starting at 10:00. Back-to-back bookings are the normal case for a
 * service business and must stay bookable.
 */
ALTER TABLE "booking_claims"
  DROP CONSTRAINT IF EXISTS "booking_claims_no_overlap";

ALTER TABLE "booking_claims"
  ADD CONSTRAINT "booking_claims_no_overlap"
  EXCLUDE USING gist (
    "product_id" WITH =,
    tsrange("starts_at", GREATEST("ends_at", "starts_at"), '[)') WITH &&
  );
