-- Broadcasts grow up: segments, promotions, scheduling — and a way for a
-- person to join the list without buying anything first.
--
-- Everything here is additive. v1 rows keep `audience_tag` and keep meaning
-- what they meant: `lib/broadcasts/segments.ts` reads a null `audience_filter`
-- with a tag beside it as a one-rule filter, so a broadcast sent last month
-- still reports the audience it actually went to.

/* -------------------------------------------------------------------------- */
/*  The audience, as a question rather than a tag                              */
/* -------------------------------------------------------------------------- */

-- Deliberately nullable with no default. `{}` as a default would be a filter
-- object on every historic row claiming to be the audience that row was sent
-- to, which is exactly the invented history the fallback exists to avoid.
ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "audience_filter" jsonb;

/* -------------------------------------------------------------------------- */
/*  The promotion                                                              */
/* -------------------------------------------------------------------------- */

ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "preview_text" text;

-- SET NULL, not CASCADE: deleting a coupon must not delete the record that a
-- broadcast went to nine hundred people.
ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "coupon_id" uuid;
DO $$
BEGIN
  ALTER TABLE "broadcasts"
    ADD CONSTRAINT "broadcasts_coupon_id_coupons_id_fk"
    FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "broadcasts"
  ADD COLUMN IF NOT EXISTS "product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "cta_label" text;
ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "cta_url" text;

/* -------------------------------------------------------------------------- */
/*  Scheduling                                                                 */
/* -------------------------------------------------------------------------- */

ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp;

-- The scheduler's own question — "what is due" — across every shop at once.
-- Partial, because `sent` is the status the table fills up with and none of
-- those rows can ever be due again.
CREATE INDEX IF NOT EXISTS "broadcasts_due_idx"
  ON "broadcasts" ("status", "scheduled_at")
  WHERE "status" = 'scheduled';

/* -------------------------------------------------------------------------- */
/*  Where a person subscribes                                                  */
/* -------------------------------------------------------------------------- */

ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "subscribe_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "subscribe_incentive" text;

-- Signups arrive by email address, and the form must never become a way to
-- ask whether an address is already on a shop's list. The lookup that keeps
-- that promise is `(shop_id, lower(email))`, which the existing
-- `clients_shop_email_key` cannot serve — it indexes the stored casing, so a
-- signup as `Ada@x.com` for a row stored as `ada@x.com` would miss the unique
-- index and raise instead of updating.
CREATE INDEX IF NOT EXISTS "clients_shop_email_lower_idx"
  ON "clients" ("shop_id", lower("email"));

-- Segment rules ask "did this person ever buy this product", which reads
-- order lines by product within one shop's orders. Without this the question
-- is a sequential scan of every line the shop has ever sold, once per rule.
CREATE INDEX IF NOT EXISTS "order_items_product_order_idx"
  ON "order_items" ("product_id", "order_id");
