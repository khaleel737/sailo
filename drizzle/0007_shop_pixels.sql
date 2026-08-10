-- The seller's own tracking tags — Google Analytics, Tag Manager, and the
-- Meta / TikTok ad pixels for campaigns they run to their own page.
--
-- Bare ids, never markup: the storefront builds each script from a fixed
-- template, so a seller can configure tracking without being able to inject
-- code into a page we serve. Shapes are enforced in `lib/shop-pixels.ts` on
-- both the write and the read. Any of these being set is what puts the
-- consent banner on that storefront; all null means nothing changes.

ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "ga4_measurement_id" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "gtm_container_id" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "meta_pixel_id" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "tiktok_pixel_id" text;
