-- What each kind of product needs, and had nowhere to put.
--
-- Five kinds share one `products` table, and four of them were missing the
-- column that makes the kind work. Every addition here is nullable or carries
-- the default that reproduces today's behaviour exactly, so an existing
-- catalogue reads and sells identically the moment this lands.
--
-- ACROSS EVERY KIND
--
--   sku            A product sold as one thing had no code. `product_variants`
--                  has carried one per combination since options existed, and
--                  the order line snapshots whichever applies into
--                  `orders.variant_sku` — so the order had somewhere to record
--                  a code that the catalogue had nowhere to type.
--
--   max_per_order  How many units one order may take. Not stock: stock says
--                  how many exist, this says how many one person may have at
--                  once, and a ticketed event needs both — a room of 200 that
--                  also refuses anybody a fifth seat. NULL is "no cap beyond
--                  stock", which is what every existing product means.
--
-- DIGITAL
--
--   digital_delivery        file | link | code. A download is one of the three
--                           things sellers mean by "digital"; the other two —
--                           a course on someone else's platform, a Discord
--                           invite, a licence key — were being sold as files
--                           that did not exist, so the product was orderable
--                           and delivered nothing. Defaulting to 'file' is what
--                           makes every existing digital product unchanged.
--   digital_link_url        Where the buyer goes, under 'link'.
--   digital_access_details  The key or joining instructions, under 'code'.
--
-- Both are held behind `orders.download_released_at`, the same gate the files
-- and an event's join link already sit behind. They are the whole good; handing
-- one to an unpaid order gives the good away.
--
-- EVENTS
--
--   event_ends_at  Optional, and it gates nothing — sales still close at
--                  `event_starts_at`. It is what lets the buyer's page say
--                  "19:00 – 22:00" rather than "19:00".
--
-- MEMBERSHIPS
--
--   billing_interval_count         The `3` in "every 3 months". Stripe's own
--   stripe_price_interval_count    model is (interval, interval_count), so this
--   subscriptions.interval_count   is not a shape we invented — folding the
--                                  combinations into names of our own
--                                  ("quarterly") would only mean translating
--                                  them back at the boundary.
--
-- The three of them are one feature seen from three places: what the product
-- sells at, what the cached Stripe Price was minted for, and what this member
-- actually signed up on. The middle one exists because a membership moved from
-- monthly to quarterly changes neither the amount nor the interval, so a
-- staleness check comparing only those two sees an unchanged product and goes
-- on billing monthly for ever. The last one exists because a manual renewal
-- reads the subscription, not the product, and "month" alone cannot say three
-- of them.
--
-- DEFAULT 1 NOT NULL is exact: every membership sold before today was billed
-- one interval at a time.
--
-- Safe to re-run: IF NOT EXISTS throughout.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sku" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "max_per_order" integer;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "digital_delivery" text DEFAULT 'file' NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "digital_link_url" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "digital_access_details" text;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_ends_at" timestamp;

-- SERVICES
--
--   booking_buffer_minutes  Quiet minutes either side of an appointment — to
--                           clean the room, write the notes, drive to the next
--                           one. The calendar offered slots that butted
--                           straight up against each other, and nothing on the
--                           form could say otherwise. Applied by widening what
--                           counts as busy rather than by lengthening the
--                           appointment, so the buyer books the hour they pay
--                           for. Zero reproduces today's calendar exactly.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "booking_buffer_minutes" integer DEFAULT 0 NOT NULL;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "billing_interval_count" integer DEFAULT 1 NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stripe_price_interval_count" integer;

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "interval_count" integer DEFAULT 1 NOT NULL;
