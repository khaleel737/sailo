-- Spec 51, the physical half — what a seller running a real stockroom needs and
-- had nowhere to put.
--
-- The service half of that spec is Wave C's. Nothing here touches a booking.
--
-- Every column is nullable or carries the default that reproduces today's
-- behaviour exactly, and both new tables are empty: a shop that configures none
-- of this sells identically the minute after this runs. The `0034` discipline.
--
-- ─── 1. LOW-STOCK ALERTS ────────────────────────────────────────────────────
--
--   low_stock_threshold    NULL is no alert, which is every existing product.
--   low_stock_notified_at  The *claim*, not a log. One email per crossing.
--
-- The claim is what makes this safe, and it is the whole design. A seller
-- adjusting stock in a spreadsheet-like screen crosses the threshold several
-- times in a minute, and every path that lowers stock — an order, a manual
-- edit, a CSV import — would otherwise send. So the notifier is a conditional
-- UPDATE with the ceiling in the WHERE:
--
--   set low_stock_notified_at = now()
--   where stock_quantity <= low_stock_threshold and low_stock_notified_at is null
--
-- and only the caller that wins sends. Reset to NULL when stock rises back
-- above the threshold — without that, a single restock-and-resell cycle goes
-- silent for ever, which is worse than never having built it.
--
-- On `products` only, not on `product_variants`, and that is a decision rather
-- than an omission. A seller with a shirt in twelve combinations wants to know
-- their stockroom is running low, not to receive twelve emails; the alert names
-- which combinations are short. Per-variant thresholds are a real feature and a
-- different one.
--
-- ─── 2. WEIGHT AND DIMENSIONS ───────────────────────────────────────────────
--
-- `0019_shipping_zones` made per-country rates real. Rates could not vary by
-- what is *in* the box because nothing recorded it.
--
-- Grams and millimetres as integers, for exactly the reason money is in minor
-- units: a float weight compared against a band boundary is a rounding argument
-- with a carrier, and 2.3 kg is either side of a 2,300 g band depending on how
-- it was stored. No unit picker — a seller who thinks in ounces is served by a
-- label, not by a second stored unit that every reader then has to convert.
--
-- On variants too, because a large weighs more than a small and that is most of
-- what a size *is* on a physical product. NULL on a variant means "the
-- product's", the same fallback its price already has.
--
-- ─── 3. WEIGHT BANDS ────────────────────────────────────────────────────────
--
--   rate_mode     flat (today) | by_weight
--   weight_bands  [{ "upToGrams": 500, "priceCents": 350 }, …]
--
-- **No live carrier rate API.** A band table reaches every carrier in every
-- country, needs no credential at rest, and cannot go down mid-checkout. It is
-- also the thing a seller can reason about: they know what a 2 kg parcel costs
-- them because they have posted one.
--
-- A basket heavier than the last band makes that rate **unavailable** rather
-- than falling back to the top price. Undercharging silently is the seller's
-- money, and `resolveDelivery` already has the vocabulary for a rate that
-- cannot be had. A rate in `by_weight` mode with *no* bands falls back to
-- `fee_cents`, because that is the half-configured state a seller passes
-- through and it must not take their shop down on the way.
--
-- ─── 4. SHIPMENTS ───────────────────────────────────────────────────────────
--
-- `tracking_carrier` / `tracking_number` / `shipped_at` are on the order
-- *header*, so a three-item order going out in two boxes could record one
-- tracking number. That is the header-versus-lines shape this repo names as
-- recurring, and this is the fifth place it has shown up.
--
-- **The header columns stay and go on working**, populated from the *first*
-- shipment, and that is the decision the spec asks to be written down. They are
-- read by the buyer's email, the CSV export, the API resource shape, the HQ
-- panel and a dozen tests; migrating every reader in one pass is a bigger,
-- riskier change than keeping one denormalised copy that only ever moves
-- forward. Anything wanting the whole picture reads `shipments`.
--
-- Order status: `shipped` when the first shipment goes, `completed` when every
-- line is covered. **No new status** — spec 44 declined to add `delivered` for
-- the same reason, and `ORDER_STATUSES`'s own header records what happened the
-- last time a copy of that enum drifted.
--
-- `delivered_at` per shipment is what spec 45's fulfilment document needs to
-- stop saying "marked by the seller" for everything: an order half-delivered is
-- a real dispute posture and the pack has to be able to say so.
--
-- Safe to re-run: IF NOT EXISTS throughout, constraints inside DO blocks.

-- ─── 1. Low-stock alerts ────────────────────────────────────────────────────

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "low_stock_threshold" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "low_stock_notified_at" timestamp;

-- The sweep's own lookup: tracked products at or under their threshold that
-- nobody has been told about. Partial, because a threshold is set on a handful
-- of a catalogue's products and an index over mostly-NULL is mostly waste.
CREATE INDEX IF NOT EXISTS "products_low_stock_idx"
  ON "products" ("shop_id", "stock_quantity")
  WHERE "low_stock_threshold" IS NOT NULL;

-- ─── 2. Weight and dimensions ───────────────────────────────────────────────

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_grams" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "length_mm" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "width_mm" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "height_mm" integer;

ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "weight_grams" integer;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "length_mm" integer;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "width_mm" integer;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "height_mm" integer;

-- ─── 3. Weight bands ────────────────────────────────────────────────────────

ALTER TABLE "delivery_methods" ADD COLUMN IF NOT EXISTS "rate_mode" text DEFAULT 'flat' NOT NULL;
ALTER TABLE "delivery_methods" ADD COLUMN IF NOT EXISTS "weight_bands" jsonb DEFAULT '[]'::jsonb NOT NULL;

-- ─── 4. Shipments ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "shipments" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id"         uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  -- Denormalised so the seller's "what is in transit" screen needs no join, and
  -- so a shipment survives being read without its order. Same reasoning as
  -- `order_messages.shop_id`.
  "shop_id"          uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "carrier"          text,
  "tracking_number"  text,
  "tracking_url"     text,
  "shipped_at"       timestamp NOT NULL DEFAULT now(),
  -- `shipped` is not `delivered`, and `docs/chargebacks.md` says so in as many
  -- words: a tracking number reading "in transit" is not delivery. The source
  -- says who claims it arrived — the seller, the carrier, or the buyer — which
  -- is the difference between evidence and an assertion.
  "delivered_at"     timestamp,
  "delivered_source" text,
  "note"             text,
  "created_at"       timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "shipments_order_idx"
  ON "shipments" ("order_id", "shipped_at");

CREATE INDEX IF NOT EXISTS "shipments_shop_idx"
  ON "shipments" ("shop_id", "shipped_at");

-- What went in the box. The primary key is the whole of the de-duplication: one
-- line cannot appear twice in one shipment, so a double-submitted form adds
-- nothing rather than shipping the same three mugs again.
CREATE TABLE IF NOT EXISTS "shipment_items" (
  "shipment_id"   uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "order_item_id" uuid NOT NULL REFERENCES "order_items"("id") ON DELETE CASCADE,
  "quantity"      integer NOT NULL DEFAULT 1,
  PRIMARY KEY ("shipment_id", "order_item_id")
);

CREATE INDEX IF NOT EXISTS "shipment_items_order_item_idx"
  ON "shipment_items" ("order_item_id");

-- Never more of a line than the order holds, and never a negative.
--
-- In the database rather than only in the writer because coverage is what
-- decides whether an order is `completed`, and a seller who mistypes 30 for 3
-- would otherwise mark a half-shipped order finished with nothing to notice.
-- The per-line ceiling across *all* shipments is enforced in the claim, which
-- is a conditional insert; this is the floor under it.
DO $$ BEGIN
  ALTER TABLE "shipment_items"
    ADD CONSTRAINT "shipment_items_quantity_positive" CHECK ("quantity" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 5. Restock destination on a refund ─────────────────────────────────────
--
-- `restocked_at` already exists and returns units to `stock_quantity`. What was
-- missing is the seller's answer to "does this one go back on the shelf" — a
-- refund for a damaged item should not. Recorded on the order rather than
-- inferred, because the moment they know is the moment they refund.
--
-- NULL means the question was never asked, which is every refund before today,
-- and reads as "restocked" — the behaviour those orders actually had.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "restock_declined" boolean DEFAULT false NOT NULL;
