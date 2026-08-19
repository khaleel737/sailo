-- Spec 48 — digital depth: code pools, licence keys, files per variant, file
-- versions.
--
-- Every column here is nullable or carries the default that reproduces today's
-- behaviour exactly, and both new tables start empty: a catalogue that existed
-- a minute before this ran reads and sells identically a minute after. The
-- `0034_product_kinds.sql` discipline.
--
-- ─── 1. CODE POOLS ──────────────────────────────────────────────────────────
--
-- `0034` gave `digital_delivery = 'code'` a single `digital_access_details`
-- column, so a seller with 200 licence keys types one string and every buyer
-- receives it. For a Discord invite that is correct and intended; for a serial,
-- a redemption code or a one-seat invite URL it is the product being given
-- away — the first buyer shares one string and nobody else needs to pay.
--
--   code_source   NULL is the shared string, which is every product that
--                 exists today. 'pool' draws from `product_codes`;
--                 'generated' mints one per buyer from `code_pattern`.
--                 NULL rather than a defaulted 'shared' because the whole
--                 point is that an untouched row keeps behaving as it did,
--                 and a default would have to be written to every one.
--   code_pattern  For 'generated'. `SAILO-XXXX-XXXX-XXXX`: every X becomes a
--                 Crockford base32 character, everything else is literal.
--
-- A POOL OF CODES IS A PILE OF BEARER TOKENS
--
-- Handing one out is spending inventory, so every rule this repo already
-- earned applies:
--
--   * The claim is a conditional UPDATE whose subselect takes `FOR UPDATE SKIP
--     LOCKED`, so two concurrent releases take two different codes rather than
--     one blocking on the other — and never the same one twice.
--   * **Claimed at release, not at checkout.** The code is spent when
--     `orders.download_released_at` is set, exactly as the file and the event
--     join URL are. Roughly a third of card sessions are abandoned and an
--     abandoned session must burn no key.
--   * **A refund revokes and does not return it to the pool.** A key a buyer
--     has already seen is spent whatever happens next; handing it to a stranger
--     is worse than losing the unit. `revoked_at` records it and the seller is
--     told the count so they can top up.
--
-- THE POOL IS STOCK
--
-- Not a second sold-out concept. `stock_quantity` stays the authority the
-- storefront, the checkout, `max_per_order` and spec 33's waitlist already
-- read; uploading N codes adds N to it and deleting an unclaimed one takes one
-- back. Checkout reserves stock as it always did, release claims a code, and
-- the refund path returns every unit *except* the ones whose code was spent.
--
-- `unique (product_id, code)` and not `unique (code)`: two sellers can
-- legitimately hand out the same third-party string, and a global unique index
-- would make one shop's upload fail because of another's.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "code_source" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "code_pattern" text;

CREATE TABLE IF NOT EXISTS "product_codes" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id"           uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  -- Per-variant pools: "PDF only" and "PDF + Figma" hand out different keys.
  -- NULL is the product-level pool, which is every pool a seller starts with.
  "variant_id"           uuid REFERENCES "product_variants"("id") ON DELETE SET NULL,
  -- The key, the serial, or — under `digital_delivery = 'link'` — the one-seat
  -- invite URL. Validated through the same public-link guard at the write.
  "code"                 text NOT NULL,
  "claimed_by_order_id"  uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "claimed_at"           timestamp,
  "revoked_at"           timestamp,
  "created_at"           timestamp NOT NULL DEFAULT now(),
  UNIQUE ("product_id", "code")
);

-- The claim's own lookup, and the only index that has to be fast: the
-- subselect asks for the oldest unclaimed, unrevoked code for a product and
-- variant. Partial, because a sold-out pool is mostly claimed rows and an
-- index over them buys nothing.
CREATE INDEX IF NOT EXISTS "product_codes_unclaimed_idx"
  ON "product_codes" ("product_id", "variant_id", "created_at")
  WHERE "claimed_at" IS NULL AND "revoked_at" IS NULL;

-- The buyer's own delivery page, and the seller's order detail.
CREATE INDEX IF NOT EXISTS "product_codes_order_idx"
  ON "product_codes" ("claimed_by_order_id")
  WHERE "claimed_by_order_id" IS NOT NULL;

-- ─── 2. LICENCE KEYS WITH ACTIVATIONS ───────────────────────────────────────
--
-- A code pool serves anyone handing out a string. A software seller needs the
-- string to be *checkable*, and Lemon Squeezy's model is the one to copy
-- because it is the one integrators already know: a key has an activation
-- limit and a length, each activation is an *instance* with its own
-- identifier, and instances are deactivated one at a time or the key is
-- disabled outright.
--
-- WHY THE KEY IS STORED IN CLEAR AND NOT HASHED
--
-- The spec asks for both a hashed store and `key text not null`, and they
-- cannot both hold: the buyer re-reads their own key from the delivery page
-- and from an email months later, so a value we cannot reproduce is a product
-- that does not work. Same call the repo already made for `door_passes` and
-- `tickets`, which are bearer credentials for the same reason.
--
-- What the hashed store was protecting is bought another way instead:
--
--   * `key_prefix` is the indexed lookup and the only thing ever logged.
--   * The full key is compared in constant time *after* the row is found, so
--     the comparison leaks nothing about how much of a guess was right.
--   * The public endpoints are rate-limited on the key, charge misses rather
--     than lookups, and answer an unknown key and a disabled key with byte-
--     identical bodies. No response is a key-existence oracle.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "license_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "license_activation_limit" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "license_days" integer;

CREATE TABLE IF NOT EXISTS "license_keys" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id"        uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  -- Denormalised so a seller's licence list needs no join, and so the row
  -- survives being read without its product. Same reasoning as `shipments`.
  "shop_id"           uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "order_id"          uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "client_id"         uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "key"               text NOT NULL,
  -- The first group of the key. Indexed for the lookup, and the only form of
  -- the key that is ever written to a log line.
  "key_prefix"        text NOT NULL,
  -- NULL is unlimited, which is a real configuration a seller means.
  "activation_limit"  integer,
  -- From the product's licence length at mint time, so re-pricing the licence
  -- does not shorten one somebody already bought.
  "expires_at"        timestamp,
  "status"            text NOT NULL DEFAULT 'active', -- active | disabled | expired
  "created_at"        timestamp NOT NULL DEFAULT now(),
  "updated_at"        timestamp NOT NULL DEFAULT now(),
  UNIQUE ("key")
);

CREATE INDEX IF NOT EXISTS "license_keys_prefix_idx" ON "license_keys" ("key_prefix");
CREATE INDEX IF NOT EXISTS "license_keys_order_idx" ON "license_keys" ("order_id");
CREATE INDEX IF NOT EXISTS "license_keys_shop_idx" ON "license_keys" ("shop_id", "created_at");

CREATE TABLE IF NOT EXISTS "license_activations" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "license_key_id"      uuid NOT NULL REFERENCES "license_keys"("id") ON DELETE CASCADE,
  "instance_name"       text,
  "instance_identifier" text NOT NULL,
  "ip"                  text,
  "user_agent"          text,
  "activated_at"        timestamp NOT NULL DEFAULT now(),
  "deactivated_at"      timestamp,
  -- One row per machine, for ever. A machine that deactivates and comes back
  -- reuses its row rather than writing a second, so the count of live
  -- activations is `deactivated_at IS NULL` and never a running total.
  UNIQUE ("license_key_id", "instance_identifier")
);

CREATE INDEX IF NOT EXISTS "license_activations_live_idx"
  ON "license_activations" ("license_key_id")
  WHERE "deactivated_at" IS NULL;

-- ─── 3. FILES PER VARIANT ───────────────────────────────────────────────────
--
-- `product_files.product_id` existed and `variant_id` did not, so a product
-- sold as "PDF only / PDF + Figma / everything" delivered the same set to all
-- three. NULL is the product default and the fallback rule is Easytools':
-- files assigned to the ordered variant if any exist, else the product-level
-- ones.
--
-- **The download gate narrows with it.** `/api/download/[token]/[fileId]`
-- checked that a file belonged to the order's product; it must now also check
-- the file belongs to the *ordered variant or the product default*, or buying
-- the cheap variant downloads the expensive one's files and the feature is
-- inverted.
--
-- ─── 4. FILE VERSIONS ───────────────────────────────────────────────────────
--
-- A seller who fixes a typo in an ebook has buyers holding the old file and no
-- way to tell them. Versioning here is *labelling plus an announcement* and
-- deliberately not a second entitlement model: past buyers keep access to the
-- current file, which is what they expect and what already happens. There is
-- no per-order file pinning.
--
--   notify_buyers_at   The *claim*, not a log. "Tell my buyers" is a bulk mail
--                      wearing a product feature's clothes — it goes through
--                      the broadcast quota and the suppression list, and the
--                      conditional UPDATE is what stops two ticks sending it
--                      twice.

ALTER TABLE "product_files" ADD COLUMN IF NOT EXISTS "variant_id" uuid REFERENCES "product_variants"("id") ON DELETE SET NULL;
ALTER TABLE "product_files" ADD COLUMN IF NOT EXISTS "version" text;
ALTER TABLE "product_files" ADD COLUMN IF NOT EXISTS "replaces_file_id" uuid REFERENCES "product_files"("id") ON DELETE SET NULL;
ALTER TABLE "product_files" ADD COLUMN IF NOT EXISTS "notify_buyers_at" timestamp;
ALTER TABLE "product_files" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS "product_files_variant_idx"
  ON "product_files" ("product_id", "variant_id");

-- ─── 5. THE ACTIVATION CEILING NEEDS A COUNTER, NOT A COUNT ─────────────────
--
-- Added after `booking_slots` in `0046` proved the point on a different table:
-- under READ COMMITTED a ceiling checked by counting rows is not a ceiling.
-- Every statement snapshots at statement start, so concurrent callers cannot
-- see each other's uncommitted activations and all of them pass a limit that
-- should have stopped all but the first few. Ranking the committed rows
-- afterwards fails the other way — a caller whose rank query runs before its
-- siblings commit ranks itself too low.
--
-- The one shape Postgres makes atomic is a conditional UPDATE on the row that
-- holds the count: it re-reads that row under its own lock and re-evaluates the
-- WHERE against the latest committed version. `products.stock_quantity` is that
-- row for stock and `event_tiers.sold` is for a tier; this is it for a licence.
--
-- `license_activations` stays the *record* — which machine, from which address,
-- when — because that is what answers a `product_not_received` dispute. This is
-- only the ceiling.
--
-- Defaulted to the live count rather than to zero, so a key that already has
-- activations when this runs does not silently gain free seats.

ALTER TABLE "license_keys" ADD COLUMN IF NOT EXISTS "activations_used" integer NOT NULL DEFAULT 0;

UPDATE "license_keys" k
SET "activations_used" = (
  SELECT count(*) FROM "license_activations" a
  WHERE a."license_key_id" = k."id" AND a."deactivated_at" IS NULL
)
WHERE k."activations_used" = 0;

DO $$ BEGIN
  ALTER TABLE "license_keys"
    ADD CONSTRAINT "license_keys_activations_not_negative"
    CHECK ("activations_used" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
