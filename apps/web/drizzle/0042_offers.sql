-- Specs 36 and 08, built as one thing — 36 first, because it supersedes 08.
--
-- Spec 08 proposed `products.bump_product_id` + `bump_headline`: one bump per
-- product, which was its own stated v1 limit. The moment cross-sells exist the
-- two features want the same columns — display type, override price, validity
-- window, position — so building 08 as written and then replacing it a week
-- later is wasted work. This is the shared table, and 08's `via_bump`
-- attribution column is kept exactly as it specified.
--
-- ─── AFTER PAYMENT, NOT DURING ──────────────────────────────────────────────
--
-- Their reasoning, adopted verbatim, because it is right: Baymard found 66% of
-- shoppers made to pass a cross-sell before completing a transaction reported
-- extreme frustration. So:
--
--   bump       in-cart, one tap, above the pay button (spec 08)
--   crosssell  after payment, on the thank-you page, never blocking the receipt
--
-- The buyer's confirmation, files and invoice are visible before any offer is. A
-- funnel that delays a download is a support ticket.
--
-- ─── FLAT, WITH `parent_id` FROM DAY ONE ────────────────────────────────────
--
-- Theirs nests three levels deep with a drag-and-drop editor: buy → skip the
-- children, skip → see the children. `GAP-2026-08-easytools.md` §4.6 refuses
-- the tree — it needs a graph editor, a traversal engine and a "which offer did
-- this buyer see" ledger, to serve the small number of sellers running a real
-- funnel, and spec 30's runner is a better home for branching than a bespoke
-- traversal in the checkout.
--
-- **`parent_id` exists and is always NULL in v1.** The column is here so that
-- nesting is a migration and an editor away rather than a rewrite. Nothing
-- writes it and nothing reads it; a row with one set is ignored.
--
-- ─── `offer_events` IS HOW A SELLER LEARNS ANYTHING ─────────────────────────
--
-- Take-rate is `taken / shown`, so `shown` is written when an offer *renders*
-- or the denominator is a guess. The unique index on (offer, order) where
-- `outcome = 'taken'` is the idempotency: one-click means double-click, and the
-- claim is taken **before** anything is charged and released on refusal — the
-- shape `PRODUCTION-PLAN.md` §2 item 4's refund race fix used.
--
-- ─── WHAT IS NOT BUILT, AND WHY IT IS NOT A GAP ─────────────────────────────
--
-- **Instant one-click charge is not in this migration and not in this release.**
-- Spec 36 describes charging the buyer's existing Stripe customer and payment
-- method from the original order. Sailo stores neither: `orders` carries
-- `stripe_session_id` and `stripe_payment_intent_id` and nothing else, no
-- Checkout Session sets `setup_future_usage`, and there is no card-on-file
-- anywhere in the product. Building it means consent to store a card, an EU
-- mandate, an SCA fallback when the off-session charge is refused, and a
-- surface for a buyer to see and remove a stored method — a money-path release
-- of its own with its own scenario suite.
--
-- The spec names the answer for exactly this case: *"Redirect to a normal
-- checkout where anything is missing — this is the honest default and it must
-- be the fallback for everything."* So every taken offer becomes an ordinary
-- re-priced checkout for a new, separately-numbered order. `resulting_order_id`
-- is here to link the two when it lands.
--
-- Safe to re-run: IF NOT EXISTS throughout, constraints inside DO blocks.

CREATE TABLE IF NOT EXISTS "offers" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"           uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  -- 'bump' (in-cart, spec 08) | 'crosssell' (post-payment, spec 36)
  "placement"         text NOT NULL,

  -- What triggers it. NULL means every product in the shop, which is what a
  -- seller with one thing to cross-sell actually wants and saves them attaching
  -- the same offer to forty products by hand.
  "source_product_id" uuid REFERENCES "products"("id") ON DELETE CASCADE,
  -- What is offered. Cascade rather than set null: an offer whose product is
  -- gone is not an offer, and a row that renders nothing is a take-rate
  -- denominator nobody can explain.
  "offer_product_id"  uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "offer_variant_id"  uuid REFERENCES "product_variants"("id") ON DELETE SET NULL,

  -- Always NULL in v1. See the header.
  "parent_id"         uuid REFERENCES "offers"("id") ON DELETE SET NULL,

  "title"             text,
  "body"              text,
  "button_label"      text,
  "display"           text DEFAULT 'card' NOT NULL,  -- card | compact | timer

  -- An override, in the shop's minor units. NULL sells at the product's own
  -- price. **Read from this column and never from the browser** — the whole line
  -- goes through `resolveLines` like any other, so a cross-sell adds no pricing
  -- trust at all.
  "price_cents"       integer,

  "valid_from"        timestamp,
  -- Checked **at the charge**, not only at render. Theirs is explicit about it
  -- and it is the right rule: a buyer who opens a time-limited offer must not be
  -- able to complete it once it has expired, even with the page still open.
  "valid_until"       timestamp,

  "position"          integer DEFAULT 0 NOT NULL,
  "is_active"         boolean DEFAULT true NOT NULL,
  "created_at"        timestamp NOT NULL DEFAULT now(),
  "updated_at"        timestamp NOT NULL DEFAULT now()
);

-- The render-time lookup: this shop, this product, this placement, in order.
CREATE INDEX IF NOT EXISTS "offers_lookup_idx"
  ON "offers" ("shop_id", "source_product_id", "placement", "position");

-- And the shop-wide ones, which have no source product to key on.
CREATE INDEX IF NOT EXISTS "offers_shop_idx"
  ON "offers" ("shop_id", "placement", "position");

CREATE TABLE IF NOT EXISTS "offer_events" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "offer_id"          uuid NOT NULL REFERENCES "offers"("id") ON DELETE CASCADE,
  -- The order the offer was shown against. Set null rather than cascade: a
  -- deleted order must not take a seller's take-rate history with it.
  "order_id"          uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  -- The order taking it produced, once there is one.
  "resulting_order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "outcome"           text NOT NULL,  -- shown | taken | skipped | expired
  "created_at"        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "offer_events_offer_idx"
  ON "offer_events" ("offer_id", "created_at");

-- The idempotency, and the reason it is partial.
--
-- One-click means double-click. A buyer who taps twice must take an offer once,
-- so the claim is this index: the insert is attempted *before* the checkout is
-- built and the loser gets nothing. It covers `taken` only — `shown` is written
-- on every render and a unique index over that would silently swallow the
-- second impression, which is the take-rate denominator.
CREATE UNIQUE INDEX IF NOT EXISTS "offer_events_taken_key"
  ON "offer_events" ("offer_id", "order_id")
  WHERE "outcome" = 'taken' AND "order_id" IS NOT NULL;

-- ─── Attribution, on the line ───────────────────────────────────────────────
--
-- Spec 08's column, kept exactly as it specified, plus 36's alongside it.
--
-- On the *line* and not the order: a basket holding a mug and the bump attached
-- to it is one order with two lines, and only one of them came from the bump.
-- The order header would attribute both, which is the header-versus-lines shape
-- this repo names as recurring.
--
-- **Set server-side only.** A client flag saying "this was a bump" is a client
-- telling us its own conversion rate.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "via_bump" boolean DEFAULT false NOT NULL;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "via_offer_id" uuid;

DO $$ BEGIN
  ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_via_offer_id_offers_id_fk"
    FOREIGN KEY ("via_offer_id") REFERENCES "offers"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Income's "did bumps convert" question, which is a filter on the lines.
CREATE INDEX IF NOT EXISTS "order_items_via_offer_idx"
  ON "order_items" ("via_offer_id")
  WHERE "via_offer_id" IS NOT NULL;

-- ─── The thank-you page ─────────────────────────────────────────────────────
--
-- Fixed copy in 35 locales today. It gains a headline, a body, and an optional
-- redirect.
--
-- **The redirect is opt-in and never default, and the receipt renders first.** A
-- redirect that fires before the buyer has their download link is a lost order
-- and a support ticket, which is the same reasoning that puts cross-sells after
-- payment rather than during it.
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "thank_you_headline" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "thank_you_body" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "thank_you_redirect_url" text;
-- Seconds. NULL or 0 is no redirect however the URL is set, so clearing the
-- delay is a way to switch it off without losing the address.
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "thank_you_redirect_delay" integer;
