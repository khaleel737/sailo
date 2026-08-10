-- Outbound click tracking: "where do my customers go".
--
-- One row per click on an outbound surface — social icons, contact handoffs,
-- external links. `target_host` is the host alone, derived server-side from
-- the posted URL; the full URL is never stored because its query string can
-- carry the buyer's own words (a prefilled WhatsApp message is the whole
-- order). `kind` names the surface: social | product_link | contact | other.
--
-- Deliberately a plain table where `visits` is partitioned: clicks are an
-- order of magnitude rarer than pageviews. Revisit if check:load disagrees.

CREATE TABLE IF NOT EXISTS "clicks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "target_host" text NOT NULL,
  "kind" text DEFAULT 'other' NOT NULL,
  "session_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- The dashboard asks "this shop, this window", the same shape as visits.
CREATE INDEX IF NOT EXISTS "clicks_shop_created_idx"
  ON "clicks" ("shop_id", "created_at");
