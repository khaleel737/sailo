-- One row per appointment a shop currently owes.
--
-- Written by hand rather than by `db:push`, which diffs the whole schema and
-- is more than an additive change needs — and more than is safe while another
-- agent may have schema work in flight.
--
-- Purely additive: a new table nothing reads yet, so it can be applied before
-- the code that uses it ships. That order is the point. The last time three
-- columns went out ahead of their migration, every shop page went down —
-- Drizzle selects every column its schema declares, so one column the database
-- has never heard of breaks `select … from shops` and everything reading a
-- shop with it. The build, the tests and the types were all green, because
-- none of the three connects to a database.

CREATE TABLE IF NOT EXISTS "booking_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "starts_at" timestamp NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- The constraint that makes a booking exclusive. Two orders cannot hold one
-- product at one instant, and Postgres is what decides it rather than
-- whichever request happened to read first.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_claims_slot_key"
  ON "booking_claims" ("product_id", "starts_at");

CREATE INDEX IF NOT EXISTS "booking_claims_order_idx"
  ON "booking_claims" ("order_id");

-- Backfill: every appointment currently on the books that still holds its
-- time. Without this the first order after deploy could claim a slot an
-- existing order already owns. `ON CONFLICT DO NOTHING` because two existing
-- orders may already share a slot — that is the bug this table prevents, and
-- the right response to finding one is to leave both rows alone and let the
-- seller sort it out, not to fail the migration.
INSERT INTO "booking_claims" ("product_id", "starts_at", "order_id")
SELECT DISTINCT ON (oi."product_id", oi."scheduled_for")
       oi."product_id", oi."scheduled_for", oi."order_id"
FROM "order_items" oi
JOIN "orders" o ON o."id" = oi."order_id"
WHERE oi."scheduled_for" IS NOT NULL
  AND oi."product_id" IS NOT NULL
  AND o."status" NOT IN ('cancelled', 'refunded')
ORDER BY oi."product_id", oi."scheduled_for", oi."created_at"
ON CONFLICT DO NOTHING;
