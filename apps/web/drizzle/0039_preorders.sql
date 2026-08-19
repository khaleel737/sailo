-- Spec 33 — the last blue medium selling on a Tuesday.
--
-- Two answers to one moment: a buyer wants something there is none of. They can
-- be told when it returns, or they can buy it now against stock that does not
-- exist yet with a date they were shown first.
--
-- This replaces the waitlist spec, which is in `deferred/`. A waitlist is a
-- digital-launch instrument — availability is a date the creator picks — and
-- Sailo's sellers ship things.
--
-- Every column is nullable or defaulted and the table is new, so a shop that
-- turns none of it on sells identically the minute after this runs.
--
-- ─── `variant_id` IS THE SUBJECT, NOT `product_id` ──────────────────────────
--
-- "Tell me when the blue medium is back" is the request. Notifying that person
-- because the *red* one arrived is the failure that turns a helpful message into
-- a complaint, and it is the one this whole schema is shaped to prevent. Every
-- read and every notification is keyed on the variant; the product is there for
-- the join and for the seller's list.
--
-- NULL is legitimate and means "this product is sold as one thing" — which is
-- why the claim compares with `is not distinct from` rather than `=`.
--
-- ─── WHY THERE ARE TWO PARTIAL UNIQUE INDEXES, AND WHY BOTH SAY
--     `NULLS NOT DISTINCT` ─────────────────────────────────────────────────
--
-- The same reason `policy_snapshots` needed two in `0035`: Postgres treats
-- NULLs as distinct, so a single `unique (product_id, variant_id, email, phone)`
-- would let one person register five times by leaving `phone` null each time. A
-- contact may hold **one** open request per variant, and "contact" means
-- whichever of the two they gave.
--
-- `NULLS NOT DISTINCT` closes the half of that the spec's own sketch left open.
-- `variant_id` is null for every product sold as one thing, so under the default
-- distinct-NULL rule the constraint would not fire *at all* for exactly those
-- products — the same address could be registered a thousand times against one
-- mug. Postgres 15 added the modifier; Neon and the scenario container are both
-- past it.
--
-- ─── ONE NOTIFICATION PER REQUEST, EVER ─────────────────────────────────────
--
-- `notified_at` is the claim. The row is spent when it is taken:
--
--   update stock_requests set notified_at = now()
--   where product_id = $1 and variant_id is not distinct from $2
--     and notified_at is null
--   returning id, email, phone, locale
--
-- A seller who restocks on Monday, sells out by lunch and restocks on Wednesday
-- must not message the same person twice in three days — that is the behaviour
-- that gets a sending domain reported. Somebody who wants telling again asks
-- again.
--
-- Send order is oldest first, and the seller's screen says so. If forty people
-- are waiting for twelve units, "I asked first" is the only fair reading that
-- does not need explaining.
--
-- ─── PREORDERS CHARGE AT CHECKOUT ───────────────────────────────────────────
--
-- Like any other order, which is what every Shopify preorder does. The
-- alternative — authorise, hold, watch it expire in seven days, re-authorise,
-- and decide what happens when the re-authorisation fails after the buyer was
-- promised the goods — is most of a feature for very little.
--
-- What charging up front buys is a **duty**, and `preorder_expected_at` is the
-- whole of it: the date is shown before the buyer commits and recorded on the
-- order. A card payment for goods that arrive six weeks later is a chargeback
-- waiting to happen if the buyer was never told six weeks. Spec 44 is what
-- answers that dispute — `policy_snapshots`, `order_messages`, and
-- `orders.delivered_at` — so the promised date is recorded the same way.
--
-- NULL means "no date given", which is honest and must render as that rather
-- than as a blank.
--
-- Safe to re-run: IF NOT EXISTS throughout, constraints inside DO blocks.

CREATE TABLE IF NOT EXISTS "stock_requests" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"     uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "product_id"  uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  -- Null only for a product sold as one thing. See the header.
  "variant_id"  uuid REFERENCES "product_variants"("id") ON DELETE CASCADE,
  "email"       text,
  "phone"       text,
  -- Where they were standing: the notification's language, and evidence to the
  -- seller that the demand is real rather than a number on a screen.
  "locale"      text,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  -- Set when the notification actually went. Null means owed.
  "notified_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_requests_product_variant_email_key"
  ON "stock_requests" ("product_id", "variant_id", "email")
  NULLS NOT DISTINCT
  WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "stock_requests_product_variant_phone_key"
  ON "stock_requests" ("product_id", "variant_id", "phone")
  NULLS NOT DISTINCT
  WHERE "phone" IS NOT NULL;

-- The seller's list: who is waiting, newest first.
CREATE INDEX IF NOT EXISTS "stock_requests_shop_idx"
  ON "stock_requests" ("shop_id", "created_at");

-- The claim's own lookup, and the only one on the hot path. Partial on
-- `notified_at is null`, because a spent row is never read again — so the index
-- holds the queue rather than its whole history.
CREATE INDEX IF NOT EXISTS "stock_requests_owed_idx"
  ON "stock_requests" ("product_id", "variant_id")
  WHERE "notified_at" IS NULL;

-- ─── Preorders ──────────────────────────────────────────────────────────────

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "preorder_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "preorder_expected_at" timestamp;
-- A ceiling on preorders, separate from stock. Null is uncapped, which is what
-- every product means today. Claimed by counting open preorders for the
-- variant, in the statement that takes one — never a read then a write.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "preorder_limit" integer;

ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "preorder_expected_at" timestamp;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "preorder_limit" integer;

-- Set at checkout when any line was taken against absent stock.
--
-- A flag on the order and not only on the line, deliberately: the seller's list
-- has to show it without a join and the confirmation email has to say it. It is
-- **not** a different order type and gets no new status — `ORDER_STATUSES` stays
-- as it is, and its own header records what happened last time a copy of it
-- drifted. A preorder becomes an ordinary fulfilment the day stock arrives.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "is_preorder" boolean DEFAULT false NOT NULL;

-- What the buyer was promised, snapshotted onto the order.
--
-- Not a reference to the product's column: a seller who slips the date next
-- month must not change what this buyer was told today. That is the same
-- argument `0035` makes about `shops.terms_url`, and it is the difference
-- between evidence and a URL.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "preorder_expected_at" timestamp;

-- The seller's "what am I owed" screen: preorders that have not shipped.
CREATE INDEX IF NOT EXISTS "orders_open_preorders_idx"
  ON "orders" ("shop_id", "created_at")
  WHERE "is_preorder" AND "shipped_at" IS NULL;
