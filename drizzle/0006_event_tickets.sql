-- Events sell admissions, and an admission is a row.
--
-- `event_starts_at` is the moment ticket sales close; capacity and tiers are
-- the existing stock and variant machinery, which is what already guarantees
-- the last seat sells once. One ticket row per unit bought — the door admits
-- people, not orders — each carrying its own code, claimed `used` atomically
-- by the check-in screen. Validity rides the order's release timestamp, the
-- same webhook-retry-safe claim that opens a digital order's files.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_starts_at" timestamp;

CREATE TABLE IF NOT EXISTS "tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "product_id" uuid,
  "code" text NOT NULL,
  "status" text DEFAULT 'valid' NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_shop_id_shops_id_fk"
  FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "tickets_code_key" ON "tickets" USING btree ("code");
CREATE INDEX IF NOT EXISTS "tickets_order_idx" ON "tickets" USING btree ("order_id");
CREATE INDEX IF NOT EXISTS "tickets_shop_idx" ON "tickets" USING btree ("shop_id");
