-- Spec 43 — the four pricing shapes one `products` table could not express.
--
-- Every column is nullable or carries the default that reproduces today's
-- behaviour exactly, in the style of `0034_product_kinds.sql`: a catalogue that
-- existed a minute before this ran reads and sells identically a minute after.
--
-- NO SIXTH PRODUCT KIND, AND NO `donation` MODE
--
-- A donation is `pricing_mode = 'pwyw'` with `min_price_cents = 0` on a digital
-- product with no file. Adding a kind to express it would fork every `switch`
-- on `ProductKind` in the tree — fulfilment, the storefront tile, the order
-- line, the CSV export, the API resource shape — to say something none of them
-- are asking about, because the difference is entirely a *pricing* one. The
-- product-template picker still offers "Donation"; a template that sets three
-- columns is not a kind.
--
-- PAY WHAT YOU WANT
--
--   pricing_mode            fixed | pwyw. Defaulted rather than nullable
--                           because every read branches on it and a null third
--                           state would be a bug in whichever branch forgot it.
--
--   min_price_cents         The floor. **NULL and 0 mean different things and
--                           this is the whole blank-versus-zero trap on this
--                           column.** 0 is "free is allowed" — a donation, a
--                           name-your-price download. NULL is "not configured",
--                           which reads as the list price, so a product
--                           switched to PWYW before the seller types a floor
--                           does not become free the moment the mode changes.
--
--   suggested_price_cents   What the amount field opens on. NULL falls back to
--                           the list price.
--
-- The floor is enforced in `resolveLines`, which `previewOrder` and
-- `createOrderIntent` are both built on — so the quote and the charge cannot
-- disagree about what was entered. That clamp is the entire security content of
-- this feature: PWYW is the one place in the whole checkout where a price comes
-- from the request.
--
-- SELL WINDOWS
--
--   sell_from / sell_until  On products *and* variants, because an early-bird
--                           tier expires while the product keeps selling. A
--                           variant's window **narrows** its product's and can
--                           never widen it: the effective start is the later of
--                           the two and the effective end the earlier.
--
--   hide_when_unavailable   Whether a closed window takes the product off the
--                           grid or leaves it there reading as unavailable.
--                           Both are wanted — an ended launch is often exactly
--                           where the back-in-stock form should live (spec 33),
--                           and a product that is not out yet more often should
--                           not be on the page at all.
--
-- Availability is **computed, never stored**. There is no `is_available` column
-- here on purpose: a stored flag drifts the moment a cron misses a tick, and
-- the drift is invisible — the product simply goes on selling, or stops.
-- Comparing two instants costs nothing and cannot be stale.
--
-- `timestamp`, not `timestamptz`, matching every other moment column in this
-- schema (`event_starts_at`, `scheduled_for`, `sent_at`). The admin form
-- converts the seller's typed wall-clock date in `shops.time_zone` to an
-- instant at the write, through `zonedTimeToInstant` — so the DST question is
-- answered once, at the edge, and every read downstream is an instant
-- comparison that cannot get it wrong.
--
-- MANUAL-RAIL FREE TRIALS need no column. `products.trial_days` already exists
-- and was Stripe-only; what was missing was a code path, not a place to put a
-- number. See `packages/commerce/src/memberships/renewals.ts`.
--
-- PAYMENT PLANS AND INSTALMENTS are refused — `GAP-2026-08-easytools.md` §4.7.
-- Nothing here is a step towards them.
--
-- Safe to re-run: IF NOT EXISTS throughout, and no constraints added.

-- ─── Pay what you want ──────────────────────────────────────────────────────

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pricing_mode" text DEFAULT 'fixed' NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "min_price_cents" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "suggested_price_cents" integer;

-- ─── Sell windows ───────────────────────────────────────────────────────────

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sell_from" timestamp;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sell_until" timestamp;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "hide_when_unavailable" boolean DEFAULT false NOT NULL;

ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "sell_from" timestamp;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "sell_until" timestamp;

-- The seller's own "what is on sale right now" list, and spec 33's trigger for
-- the not-released-yet case. Partial on both sides so it indexes only the
-- products that have a window at all, which in any real catalogue is a handful:
-- an index over a column that is NULL for 99% of rows is mostly waste.
CREATE INDEX IF NOT EXISTS "products_sell_window_idx"
  ON "products" ("shop_id", "sell_from", "sell_until")
  WHERE "sell_from" IS NOT NULL OR "sell_until" IS NOT NULL;
