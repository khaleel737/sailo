-- Spec 40 — gated content collections. "Courses", narrowly.
--
-- `deferred/18-ecourse.md` was parked as not Sailo's product direction, and the
-- re-opening is deliberately not a re-opening of *that*: a video player with
-- layout editors, transcoding and DRM is a separate business with a separate
-- cost base, and it stays out. What Sailo is one step from is ordered, gated,
-- resumable content — and four of the five hard parts are already built:
--
--   files, ordered                        `product_files.position`
--   delivery behind a gate                `/download/[token]`, hashed tokens
--   entitlement decided at *read* time    `membershipAccess`, `door_passes`
--   recurring access, card and manual     `subscriptions.billing_mode`
--   grouping, order, progress, a page     ← this migration
--
-- ─── IT WRITES NO NEW ACCESS PREDICATE ──────────────────────────────────────
--
-- There is no `is_unlocked`, no `access_level`, no per-item entitlement column
-- anywhere below, and that absence is the spec's own instruction:
-- `membershipAccess` is the single implementation of "may this buyer see this",
-- and that property is why grace periods, the members list, the download gate,
-- the door pass and cancellation all behave consistently. Gated content asks the
-- same question, so it asks the same function.
--
-- ─── AND `section` IS A LABEL, NOT A TABLE ──────────────────────────────────
--
-- A three-level hierarchy (course → module → lesson) needs a tree, an editor and
-- a traversal. A text label plus `position` renders the same page and is one
-- column. Promote it only if sellers ask for nested modules.

CREATE TABLE IF NOT EXISTS "collections" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"             uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "product_id"          uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,

  "title"               text NOT NULL,
  "description"         text,

  -- none | interval. Drip is computed at read time and never stored as a date:
  -- a stored unlock date is wrong the moment a seller changes the interval.
  "drip_mode"           text NOT NULL DEFAULT 'none',
  "drip_interval_days"  integer,

  "created_at"          timestamp NOT NULL DEFAULT now(),
  "updated_at"          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "collections_shop_product_idx"
  ON "collections" ("shop_id", "product_id");

-- One collection per product in v1. A second would need the buyer's page to ask
-- which, and there is no screen in this spec that asks anybody anything.
CREATE UNIQUE INDEX IF NOT EXISTS "collections_product_key"
  ON "collections" ("product_id");

CREATE TABLE IF NOT EXISTS "collection_items" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "collection_id"         uuid NOT NULL REFERENCES "collections"("id") ON DELETE CASCADE,

  -- A label, not a table. See the header.
  "section"               text,

  -- Deleting a file cascades its item: the collection renders shorter and does
  -- not break, and the seller is told the count before they delete.
  "file_id"               uuid REFERENCES "product_files"("id") ON DELETE CASCADE,

  -- An allowlisted embed. Goes through the SSRF guard **at the write**, never at
  -- render — the same rule, and the same four writes that had to be fixed once.
  "external_url"          text,

  "title"                 text NOT NULL,
  "body_md"               text,
  "position"              integer NOT NULL DEFAULT 0,

  -- Readable without an order, which is how a seller shows lesson one for free.
  -- A preview is therefore **public**, and must never be a real file: a preview
  -- that minted a download token would be a paid file given away.
  "is_preview"            boolean NOT NULL DEFAULT false,

  -- Overrides the collection's drip for this item.
  "available_after_days"  integer,

  "created_at"            timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "collection_items_collection_idx"
  ON "collection_items" ("collection_id", "position");

-- ─── Progress ───────────────────────────────────────────────────────────────
--
-- Keyed on the **order**, not the buyer. There are no buyer accounts
-- (`GAP-2026-08-easytools.md` §4.8): the order *is* the entitlement and the
-- download token already resolves to one. Keying on an email would let a shared
-- address read somebody else's progress.

CREATE TABLE IF NOT EXISTS "content_progress" (
  "order_id"      uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "item_id"       uuid NOT NULL REFERENCES "collection_items"("id") ON DELETE CASCADE,
  "completed_at"  timestamp,
  "last_seen_at"  timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("order_id", "item_id")
);

CREATE INDEX IF NOT EXISTS "content_progress_order_idx"
  ON "content_progress" ("order_id");
