-- Spec 38 — where the seller is registered, what they took where, and which
-- countries they will not sell into.
--
-- Three new tables and five new columns. Every column is nullable or carries
-- the default that reproduces today's behaviour exactly, and no existing row is
-- rewritten, so a shop that never opens the new tab sells identically the
-- moment this lands.
--
-- WHAT THIS IS NOT
--
-- Not a tax engine. Stripe Tax computes rates on the seller's own connected
-- account, with the seller's registrations and the seller's liability, and
-- `GAP-2026-08-easytools.md` §4.3 refused becoming a tax provider. Everything
-- here is bookkeeping over money Sailo already recorded — the point is that a
-- seller crossing a registration threshold finds out from their own dashboard
-- rather than from a letter.
--
-- TAX_REVENUE_DAILY, AND THE COLUMN THE SPEC'S SKETCH LEFT OUT
--
-- The spec keys the fold on (shop, country, region, day). `currency` is in the
-- key here as well, and it has to be: a shop that changed its own currency
-- partway through a year would otherwise add GBP and USD minor units into one
-- bigint that no reader could ever separate. The same spec requires revenue to
-- be "counted in the order's own currency … converted at display time only",
-- which is only possible while the stored row still knows what currency it is.
-- A shop that never changed currency has exactly the rows the sketch describes.
--
-- `bigint` for the money columns rather than `integer`: these are running
-- totals over years, and `integer` cents tops out around €21m — reachable by a
-- shop that succeeds, and the failure would be an overflow on the one screen
-- that says what they owe.
--
-- `region` defaults to '' rather than NULL because it is in the primary key,
-- and a NULL there would let the same day be folded twice. `tax_jurisdictions`
-- keeps region nullable — a national registration genuinely has none — and so
-- its uniqueness is built on `coalesce(region, '')` for the same reason: two
-- NULLs are distinct to a plain unique index, and a seller would be able to add
-- Germany twice.
--
-- Safe to re-run: IF NOT EXISTS throughout, and the one foreign-key-bearing
-- CREATE TABLE carries its references inline where they are created with the
-- table.

CREATE TABLE IF NOT EXISTS "tax_jurisdictions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "country" text NOT NULL,
  "region" text,
  "registration_number" text,
  "registered_on" date,
  "expires_on" date,
  -- NULL means "use the shop's flat rate"; a stored 0 means "zero-rated here".
  -- Blank is not zero, and these two are different instructions.
  "rate_bp" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "tax_jurisdictions_shop_idx"
  ON "tax_jurisdictions" ("shop_id");

CREATE UNIQUE INDEX IF NOT EXISTS "tax_jurisdictions_shop_place_key"
  ON "tax_jurisdictions" ("shop_id", "country", coalesce("region", ''));

CREATE TABLE IF NOT EXISTS "tax_country_rules" (
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "country" text NOT NULL,
  "sales_enabled" boolean DEFAULT true NOT NULL,
  "auto_disabled_at" timestamp,
  "auto_disabled_reason" text,
  -- The alert claim. Written in a conditional UPDATE with the rung in the
  -- WHERE, never read-then-written: two overlapping cron ticks otherwise both
  -- see "not sent" and the seller is warned twice about the same threshold.
  "alerted_rungs" text[] DEFAULT '{}' NOT NULL,
  "alerted_year" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tax_country_rules_pkey" PRIMARY KEY ("shop_id", "country")
);

CREATE TABLE IF NOT EXISTS "tax_revenue_daily" (
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "country" text NOT NULL,
  "region" text DEFAULT '' NOT NULL,
  "day" date NOT NULL,
  "currency" text NOT NULL,
  "net_cents" bigint DEFAULT 0 NOT NULL,
  "tax_cents" bigint DEFAULT 0 NOT NULL,
  "b2b_net_cents" bigint DEFAULT 0 NOT NULL,
  "order_count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tax_revenue_daily_pkey"
    PRIMARY KEY ("shop_id", "country", "region", "day", "currency")
);

CREATE INDEX IF NOT EXISTS "tax_revenue_daily_shop_day_idx"
  ON "tax_revenue_daily" ("shop_id", "day");

-- The four switches on the tab, and the product-level category override.
--
-- `tax_disable_on_threshold` defaults to false on purpose. The safe-looking
-- default would silently close a seller's best market while they were asleep;
-- a seller who wants that has decided registering somewhere costs more than the
-- sales, which is a judgement only they can make.

ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "tax_oss_registered" boolean DEFAULT false NOT NULL;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "tax_disable_on_threshold" boolean DEFAULT false NOT NULL;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "tax_disable_immediate_obligation" boolean DEFAULT false NOT NULL;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "tax_category" text;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tax_category" text;
