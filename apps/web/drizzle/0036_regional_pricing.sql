-- Selling in the buyer's currency, at a price the seller typed.
--
-- `README.md`'s "Not built yet" opens with this line. The whole design is in
-- `docs/specs/53-regional-pricing.md`; what matters for reading the SQL is that
-- **nothing here is a conversion**. Every number these columns will hold was
-- typed by a seller, in the currency it is charged in. There is no rate stored
-- anywhere, because none was used: a rate that moves between the price shown
-- and the order written is a price the buyer never agreed to, and a
-- seller-typed price is one that can be rounded to read well — which is most
-- of the conversion lift this feature exists for.
--
-- WHY COLUMNS AND NOT A `product_prices` TABLE
--
-- The fact being stored is "what this row costs in currency C" — an attribute
-- of the row, read on every path that already reads the row, written by the
-- same form that writes `price_cents`. A table would add a join to the
-- storefront catalogue query, the cart, the buy box, `resolveLines`, the admin
-- product form and the CSV importer, to carry at most nine small integers per
-- product.
--
-- THE SHAPE
--
--   { "EUR": { "price": 2500, "secondary": 3000 } }
--
-- Minor units *in that currency*, decided by `currencyDecimals` and never by a
-- flat 100 — the assumption that once turned ¥1,000 into ¥10. One shape across
-- all four tables, so one validator and one reader serve them; `secondary` is
-- whatever second amount the row already had beside its price:
--
--   products / product_variants   compare-at
--   delivery_methods              free-over threshold
--   coupons                       minimum subtotal
--
-- An absent currency is **not** a zero and **not** a fallback. It is what makes
-- that currency not offered at all, which is the only safe answer when nobody
-- has said what the price should be. `atCurrency` in
-- `packages/core/src/money/regional.ts` returns null rather than the row's own
-- price, so a half-configured currency can never put a euro sign in front of a
-- dollar integer.
--
-- Entirely additive, every column defaulted, following
-- `0034_product_kinds.sql`: an existing catalogue reads and sells identically
-- the moment this lands, and `{}` on every existing row means exactly what it
-- says — this shop quotes one currency, as it did yesterday.

-- Which currencies the shop offers beyond its own. ISO 4217, uppercase, never
-- containing `shops.currency` itself. This is what the seller *ticked*; which
-- of them a buyer can actually be quoted is decided by `liveCurrencies`, which
-- requires every published product, priced variant, enabled delivery rate and
-- active coupon to carry a price in it.
ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "regional_currencies" text[] DEFAULT '{}'::text[] NOT NULL;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "currency_prices" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "currency_prices" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE "delivery_methods"
  ADD COLUMN IF NOT EXISTS "currency_prices" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE "coupons"
  ADD COLUMN IF NOT EXISTS "currency_prices" jsonb DEFAULT '{}'::jsonb NOT NULL;

-- `liveCurrencies` asks each of these "is there a published row in this shop
-- **without** a price in currency C". That is a NOT EXISTS over a jsonb key
-- test, and on a Business catalogue with no ceiling it is the one query on the
-- storefront's cached path that grows with the catalogue.
--
-- Partial, on published rows only, because an unpublished product cannot be
-- bought and therefore cannot hold a currency back.
CREATE INDEX IF NOT EXISTS "products_shop_currency_prices_idx"
  ON "products" ("shop_id")
  WHERE "is_published";
