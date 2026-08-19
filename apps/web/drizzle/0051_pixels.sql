-- Spec 42 — three more pixels, four tiles, share links, link vocabulary.
--
-- Four nullable columns on `shops` and one new table, so an existing shop
-- reads and sells identically the moment this lands.
--
-- DATAFAST IS REFUSED
--
-- Theirs lists it alongside the rest. A named third-party analytics vendor in
-- our settings is an endorsement and a support surface — every seller who
-- cannot make it work asks us, and we do not run it. The four below are
-- different in kind: Google Ads, LinkedIn and Pinterest are ad platforms a
-- seller is already buying from, and the id is the *receipt* for spend they
-- have made elsewhere.
--
-- Each goes through spec 09's three gates or it does not ship: a validated id
-- (an unvalidated one is script injection in a `<script>` src), the consent
-- gate, and the CSP. See `packages/customers/src/shop-pixels.ts`, which now
-- derives the CSP host list from the provider table rather than repeating it —
-- a hand-kept second list is how a pixel ships that silently never loads.

ALTER TABLE "shops"
  -- `AW-123456789`
  ADD COLUMN IF NOT EXISTS "google_ads_id" text,
  -- The conversion label that pairs with it. Optional: a seller may want the
  -- tag without a conversion configured yet.
  ADD COLUMN IF NOT EXISTS "google_ads_conversion_id" text,
  -- Numeric partner id.
  ADD COLUMN IF NOT EXISTS "linkedin_partner_id" text,
  -- Numeric tag id.
  ADD COLUMN IF NOT EXISTS "pinterest_tag_id" text;

-- ─── Share links ────────────────────────────────────────────────────────────

-- **The most dangerous thing in this spec**: a public URL rendering a shop's
-- revenue. Every column here is one of the rules that makes it safe, and none
-- of them is negotiable.
--
--   - The token is **hashed**, like `api_keys`. A dump of this table is not a
--     set of working links.
--   - `expires_at` is **NOT NULL**. A link that never expires is a permanent
--     public revenue feed, and "the seller can revoke it" is not an answer for
--     a link they forgot they made.
--   - `metric` and `range` are **on the row, not in the URL**. One metric and
--     one fixed window per token: the token cannot be edited into a different
--     number or a wider window, because neither is a parameter.
--
-- There is no `dashboard` value for `metric` and there must not be one.
CREATE TABLE IF NOT EXISTS "analytics_shares" (
  "id"      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,

  -- One of `SHARE_METRICS`. Aggregates only — no order rows, no buyer names.
  "metric"  text NOT NULL,
  -- One of `SHARE_RANGES`, fixed at creation.
  "range"   text NOT NULL,

  -- SHA-256 of the token, never the token. The leading characters are stored
  -- separately so the settings list can identify a link without holding one.
  "token_hash"   text NOT NULL,
  "token_prefix" text NOT NULL,

  -- Required. 30 days by default, 90 at the most.
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,

  -- Who made it, so a seller reading the list a year later knows. An address
  -- rather than a user id: staff change, and the question is "who shared our
  -- revenue", which a deleted account should not erase.
  "created_by_email" text,
  "last_viewed_at"   timestamp,
  "view_count"       integer NOT NULL DEFAULT 0,

  "created_at" timestamp NOT NULL DEFAULT now()
);

-- The public route's only lookup. Unique because two rows with one hash would
-- be two shops behind one link.
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_shares_token_hash_key"
  ON "analytics_shares" ("token_hash");

CREATE INDEX IF NOT EXISTS "analytics_shares_shop_idx"
  ON "analytics_shares" ("shop_id", "created_at");
