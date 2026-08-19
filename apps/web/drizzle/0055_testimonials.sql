-- Spec 35 — social proof about the seller, not about a product.
--
-- Three new tables and nothing altered, so a shop that never opens the screen
-- reads and sells identically the moment this lands.
--
-- WHY NOT `reviews`, WHICH ALREADY EXISTS
--
-- `reviews` is (shop, product, author, rating 1..5, body, approved). It answers
-- "what do buyers think of this product", renders on the product page, and is
-- right as it stands. A testimonial answers "should I trust this seller":
-- shop-scoped, unrated, carrying an avatar and sometimes a video, *solicited*
-- by a link rather than volunteered, and rendered in two places a review never
-- is — the checkout, and a third party's website through an iframe.
--
-- Building it as a product-less review would put an unrated, embeddable,
-- externally-served object into the query that renders product pages, and that
-- query is `"use cache"` + `cacheTag(shopTag(shopId))`. One table, two
-- audiences, two cache lifetimes, one leak away from a draft testimonial on a
-- public page.
--
-- THE EMBED KEY IS THE AUTHORISATION
--
-- `/embed/wall/[key]` is public and unauthenticated, so a guessable key is an
-- enumeration of every shop's marketing copy. It is opaque, unique, and
-- deliberately not the shop id or handle. Rotating it is the only revocation an
-- iframe somebody else pasted into their own site can have.
--
-- NULLABILITY, WHICH IS LOAD-BEARING IN THREE PLACES
--
--   wall_id     Null so a seller can collect before arranging, and so deleting
--               a wall throws away the arrangement rather than the content.
--   product_id  Null so a testimonial can be about the shop rather than a thing.
--   client_id   `set null`, not cascade. The author's name stays because they
--               typed it and the seller is relying on published marketing; what
--               must stop is the *link back to a person's record*, which is
--               exactly this column. Spec 03 keeps the ledger on deletion for
--               the same reason.
--
-- Safe to re-run: IF NOT EXISTS throughout, foreign keys declared inline with
-- the tables that carry them.

CREATE TABLE IF NOT EXISTS "testimonial_walls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "headline" text,
  "layout" text DEFAULT 'grid' NOT NULL,
  "is_published" boolean DEFAULT false NOT NULL,
  "embed_key" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "testimonial_walls_shop_slug_key"
  ON "testimonial_walls" ("shop_id", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "testimonial_walls_embed_key"
  ON "testimonial_walls" ("embed_key");

CREATE TABLE IF NOT EXISTS "testimonials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "wall_id" uuid REFERENCES "testimonial_walls"("id") ON DELETE SET NULL,
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "author_name" text NOT NULL,
  "author_role" text,
  -- Both URLs are guarded at the **write**, against the image allowlist and
  -- the embed-host allowlist. `PRODUCTION-PLAN.md` section 2 item 2 is this
  -- exact bug in four other places: a public route fetching whatever URL it
  -- was handed. The guard belongs where the value arrives.
  "author_avatar_url" text,
  "body" text,
  "video_url" text,
  "source" text DEFAULT 'manual' NOT NULL,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  -- Nothing is public until a person approves it — the same default `reviews`
  -- carries, and for the same reason: a public writable surface with no gate
  -- is a spam target.
  "is_approved" boolean DEFAULT false NOT NULL,
  "is_featured" boolean DEFAULT false NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "submitted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "testimonials_shop_approved_idx"
  ON "testimonials" ("shop_id", "is_approved", "position");
CREATE INDEX IF NOT EXISTS "testimonials_wall_idx" ON "testimonials" ("wall_id");

CREATE TABLE IF NOT EXISTS "testimonial_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "email" text NOT NULL,
  -- Hashed, never plain: a bearer credential that writes a row on a seller's
  -- shop, and a database read must not hand out live ones.
  "token_hash" text NOT NULL,
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL,
  "submitted_at" timestamp,
  "expires_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "testimonial_requests_token_key"
  ON "testimonial_requests" ("token_hash");
CREATE INDEX IF NOT EXISTS "testimonial_requests_shop_sent_idx"
  ON "testimonial_requests" ("shop_id", "sent_at");
