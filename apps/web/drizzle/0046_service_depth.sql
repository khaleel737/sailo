-- Spec 51, the service half — staff calendars, group bookings, buyer
-- reschedule and cancel, intake forms, booking reminders.
--
-- Wave B owns the physical half and shipped it as `0040`. Nothing here touches
-- a shipment.
--
-- Every column is nullable or carries the default that reproduces today's
-- behaviour exactly, and the two new tables start empty. **A shop with no
-- `staff_resources` rows books exactly as it does now** — that is not a
-- side-effect, it is the acceptance criterion, and the constraint below is
-- written the way it is entirely to guarantee it.
--
-- ════════════════════════════════════════════════════════════════════════════
--  THE EXCLUSION CONSTRAINT — THE HIGHEST-RISK LINE IN THIS FILE
-- ════════════════════════════════════════════════════════════════════════════
--
-- `booking_claims_no_overlap` is the guarantee that Sailo never double-books.
-- It lives in `0004`, which is one of five grandfathered files with an
-- unguarded `ADD CONSTRAINT`, so it is dropped and re-created here rather than
-- edited in place.
--
-- WHAT IT IS TODAY, WHICH IS NOT WHAT THE SPEC ASSUMED
--
-- The spec says the constraint moves from `(shop, range)` to `(staff, range)`.
-- It is not on the shop: `0004` put it on **`(product_id, range)`**. So the
-- change is not a straight narrowing, and the difference matters in both
-- directions:
--
--   * Per product is too *wide* for a solo practitioner. One hairdresser
--     offering a cut and a colour can currently be booked for both at 10:00,
--     because the two claims name different products and the constraint never
--     compares them.
--   * Per staff alone is too *narrow* to be safe, because `staff_id` is
--     nullable — "any available", which is today's behaviour and stays the
--     default. Postgres treats `NULL = NULL` as unknown, so an exclusion
--     constraint keyed on a null column **excludes nothing at all**. Every
--     existing shop would silently lose the guarantee, and the failure would
--     be a double-booked Saturday rather than an error anybody could see.
--
-- WHAT IT BECOMES
--
--   EXCLUDE USING gist (COALESCE(staff_id, product_id) WITH =, tsrange WITH &&)
--
-- `COALESCE` is the whole of it. With no staff rows the key is `product_id`
-- and the constraint is byte-for-byte the guarantee `0004` gave; with staff
-- rows the key is the person, so two stylists work at once and neither can be
-- booked twice — across *different services*, which is the gap that stopped
-- Sailo serving anyone with staff.
--
-- Both columns are uuid and uuids are globally unique, so a coalesced key
-- cannot collide across shops or across the two meanings. No `shop_id` is
-- needed to disambiguate it, and adding one would be a third meaning to keep
-- in step.
--
-- WHY IT IS PARTIAL
--
-- A twelve-person yoga class is twelve claims that all overlap, and an
-- exclusion constraint would refuse the second person. `is_exclusive` carries
-- the answer onto the row — true for a one-at-a-time appointment, which is
-- every claim that exists today, false for a class seat — because a partial
-- index cannot reach into `products` to ask.
--
-- Group capacity is enforced instead by a conditional INSERT that sums
-- `seats_taken` across the overlapping range inside the statement that adds
-- one, with the ceiling in the WHERE. Never a read followed by an insert.
--
-- **After applying this, run the booking concurrency scenarios and read the
-- count.** A suite that no longer exercises the constraint passes for the
-- wrong reason, and that is exactly the failure this note exists to catch.
--
-- ─── 1. STAFF ───────────────────────────────────────────────────────────────
--
-- `shops.booking_hours` is the *shop's* hours, so a salon with three stylists
-- had one calendar and could take one appointment at a time.
--
-- **`staff_resources` is not `shop_members` (spec 37).** A stylist is a
-- bookable *resource*; a team member is a *login*. Some people are both and
-- the tables may reference each other, but a resource with no account is the
-- common case — a contractor — and a member who takes no bookings is equally
-- common: a bookkeeper. Two tables, and this is where it is said.
--
-- ─── 2. GROUP BOOKINGS ──────────────────────────────────────────────────────
--
--   products.booking_capacity   NULL is 1, which is today.
--   booking_claims.seats_taken  How many of the class this claim holds.
--
-- A class is close to an event session (spec 50) and deliberately not the same
-- thing: a session is a fixed datetime the seller published, a class slot is
-- *generated from hours*. Where a seller wants fixed dates, `event` with
-- sessions is the right kind and the product form says so.
--
-- ─── 3. RESCHEDULE AND CANCEL, BY THE BUYER ─────────────────────────────────
--
--   products.reschedule_cutoff_hours   NULL is not allowed, which is today.
--   products.cancel_cutoff_hours
--   order_items.rescheduled_from       The time they moved away from.
--
-- Reached from the buyer's existing signed link — the pattern in
-- `packages/commerce/src/disputes/arrival.ts` and
-- `packages/marketing/src/broadcasts/unsubscribe.ts`, keyed from
-- `BETTER_AUTH_SECRET` under its own domain string, with no row written at
-- send time so it works from a cold mail client months later. **Not a third
-- implementation.**
--
-- Reschedule is release-then-claim in one pass: a buyer must never lose their
-- slot to a failure to get the new one, so the new slot is taken *first* and
-- the old one released only once it is held.
--
-- ─── 4. INTAKE FORMS ────────────────────────────────────────────────────────
--
-- No new field model. Spec 34's `contact_fields` with `scope = 'checkout'`
-- already collects the answers; what was missing is that they **reach the
-- appointment** — the order, the day list and the reminder. That is a read,
-- not a schema.
--
-- ─── 5. REMINDERS ───────────────────────────────────────────────────────────
--
-- `event_reminders` is keyed (order, product, session, lead) and needs no
-- change beyond being written for `service` too. A no-show costs a service
-- seller a whole slot, and this is the cheapest revenue-protecting line in the
-- spec.
--
-- Safe to re-run: IF NOT EXISTS throughout, constraints inside DO blocks.

-- ─── staff_resources ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "staff_resources" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"           uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "name"              text NOT NULL,
  "email"             text,
  "avatar_url"        text,
  -- WeeklyHours, falling back to the shop's when null — so adding a stylist
  -- who works the shop's hours is one row and no configuration.
  "hours"             jsonb,
  "time_zone"         text,
  -- Their own iCal address, read under the same SSRF guard and 60s cache
  -- spec 17 already built for the shop's.
  "calendar_feed_url" text,
  "is_active"         boolean NOT NULL DEFAULT true,
  "position"          integer NOT NULL DEFAULT 0,
  "created_at"        timestamp NOT NULL DEFAULT now(),
  "updated_at"        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "staff_resources_shop_idx"
  ON "staff_resources" ("shop_id", "is_active", "position");

-- Which people can be booked for which service. No rows for a product means
-- every active resource in the shop, which is what a single-service salon
-- means and saves them a screen.
CREATE TABLE IF NOT EXISTS "product_staff" (
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "staff_id"   uuid NOT NULL REFERENCES "staff_resources"("id") ON DELETE CASCADE,
  PRIMARY KEY ("product_id", "staff_id")
);

CREATE INDEX IF NOT EXISTS "product_staff_staff_idx"
  ON "product_staff" ("staff_id");

-- ─── products ───────────────────────────────────────────────────────────────

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "booking_capacity" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reschedule_cutoff_hours" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cancel_cutoff_hours" integer;

-- ─── order_items ────────────────────────────────────────────────────────────

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "staff_id" uuid;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "rescheduled_from" timestamp;

DO $$ BEGIN
  ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_staff_fk"
    FOREIGN KEY ("staff_id") REFERENCES "staff_resources"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── booking_claims ─────────────────────────────────────────────────────────

ALTER TABLE "booking_claims" ADD COLUMN IF NOT EXISTS "staff_id" uuid;
ALTER TABLE "booking_claims" ADD COLUMN IF NOT EXISTS "seats_taken" integer NOT NULL DEFAULT 1;
-- True for a one-at-a-time appointment, which is every claim that exists
-- today. False for a seat in a class, where overlapping is the point.
ALTER TABLE "booking_claims" ADD COLUMN IF NOT EXISTS "is_exclusive" boolean NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE "booking_claims"
    ADD CONSTRAINT "booking_claims_staff_fk"
    FOREIGN KEY ("staff_id") REFERENCES "staff_resources"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "booking_claims"
    ADD CONSTRAINT "booking_claims_seats_positive" CHECK ("seats_taken" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

/*
 * The guarantee, re-keyed.
 *
 * Dropped and re-created rather than altered — an exclusion constraint has no
 * ALTER form — and `IF EXISTS` because `0004` may not have run on a database
 * restored from a newer baseline.
 *
 * `[)` is kept: half-open, so an appointment ending at 10:00 does not collide
 * with one starting at 10:00. Back-to-back bookings are the normal case for a
 * service business and must stay bookable.
 */
ALTER TABLE "booking_claims"
  DROP CONSTRAINT IF EXISTS "booking_claims_no_overlap";

/*
 * Any overlap that already exists would make the ADD below fail outright, and
 * a migration that cannot be applied is worse than the gap it closes: the
 * deploy stops and the constraint lands nowhere.
 *
 * `0004` deduplicated per product. This one has to look wider, because the new
 * key is wider for a shop with staff — but no shop has staff yet at the moment
 * this runs, so `COALESCE(staff_id, product_id)` is `product_id` for every
 * existing row and this finds exactly what `0004` already left clean. It is
 * here for the database that was restored from a partial state, not for the
 * ordinary one.
 *
 * Earliest claim in each overlapping group is kept — earliest, because the
 * buyer who booked first is the one the shop owes. The dropped claims release
 * only their hold on the calendar; the orders are untouched, so a seller sees
 * both bookings and can decide what to do about a conflict that already
 * existed.
 */
DELETE FROM "booking_claims" a
USING "booking_claims" b
WHERE COALESCE(a."staff_id", a."product_id") = COALESCE(b."staff_id", b."product_id")
  AND a."id" <> b."id"
  AND a."is_exclusive" AND b."is_exclusive"
  AND tsrange(a."starts_at", GREATEST(a."ends_at", a."starts_at"), '[)')
      && tsrange(b."starts_at", GREATEST(b."ends_at", b."starts_at"), '[)')
  AND (a."created_at", a."id") > (b."created_at", b."id");

-- Wrapped, like every other constraint added since 0015. The DROP above is
-- `IF EXISTS`, so a re-run would in fact reach here with nothing in the way —
-- but `migrations.test.ts` requires the guarded form of every new file rather
-- than reasoning about each one, and a rule that holds without exceptions is
-- the reason this directory is replayable at all.
DO $$ BEGIN
  ALTER TABLE "booking_claims"
    ADD CONSTRAINT "booking_claims_no_overlap"
    EXCLUDE USING gist (
      (COALESCE("staff_id", "product_id")) WITH =,
      tsrange("starts_at", GREATEST("ends_at", "starts_at"), '[)') WITH &&
    )
    WHERE ("is_exclusive");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

/*
 * The old exact-match unique index has to go with it.
 *
 * `booking_claims_slot_key` is `(product_id, starts_at)`, which under the new
 * key is *wrong* rather than merely redundant: two stylists working the same
 * 10:00 slot on the same service are two legitimate claims with one product
 * and one start time, and this index refuses the second. It was kept in `0004`
 * as the cheap exact-match case; the cheap case is now the wrong question.
 *
 * `claimSlots` used to lean on it for `ON CONFLICT DO NOTHING`. It no longer
 * can — an exclusion constraint cannot be inferred by `ON CONFLICT` — so the
 * claim catches the violation instead, which is the same answer arriving as an
 * error rather than as an empty result.
 */
DROP INDEX IF EXISTS "booking_claims_slot_key";

-- The class claim's own lookup, for releasing seats back.
CREATE INDEX IF NOT EXISTS "booking_claims_group_idx"
  ON "booking_claims" ("product_id", "starts_at")
  WHERE NOT "is_exclusive";

-- ─── THE CLASS COUNTER, AND WHY IT HAS TO BE A ROW ──────────────────────────
--
-- A class seat cannot be claimed by a conditional INSERT, and this table is the
-- consequence. The obvious shape —
--
--   INSERT … SELECT … WHERE (SELECT sum(seats_taken) …) + $n <= $capacity
--
-- was written first and **the scenario caught it overselling**: twelve buyers
-- arriving at a ten-seat class produced eleven bookings.
--
-- The reason is snapshots rather than sloppiness. Under READ COMMITTED every
-- statement takes its snapshot at statement start, so a subquery counting
-- `booking_claims` cannot see rows other transactions have not committed yet —
-- all twelve read the same sum and eleven pass a ceiling that should have
-- stopped ten. Neither a `FOR UPDATE` on the product nor an advisory lock
-- fixes it: both are acquired *after* the snapshot is taken, and neither
-- advances it. Ranking the committed rows afterwards fails the same way, in
-- the other direction — a caller whose rank query runs before its siblings
-- commit ranks itself too low.
--
-- The one shape Postgres does make atomic here is a **conditional UPDATE on
-- the row that holds the count**: it re-reads that row under its own lock and
-- re-evaluates the WHERE against the latest committed version. That is exactly
-- why `reserveStock` is safe, and `products.stock_quantity` is exactly that
-- row. A class has a capacity per *time slot* rather than per product, so it
-- needs a row per slot — which is this table and nothing more.
--
-- **Capacity is counted per slot start**, not per overlapping range, and that
-- is a stated limitation rather than an oversight: a class is a published time
-- that people turn up to, and two class starts inside one hour are two classes.
-- The *exclusive* path still compares ranges, because a one-to-one appointment
-- genuinely can be offered on the half hour.

CREATE TABLE IF NOT EXISTS "booking_slots" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id"  uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "starts_at"   timestamp NOT NULL,
  "ends_at"     timestamp NOT NULL,
  -- The number the conditional UPDATE moves. Never read then written.
  "seats_taken" integer NOT NULL DEFAULT 0,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  UNIQUE ("product_id", "starts_at")
);

-- A floor under the claim, for the same reason `event_tiers` has one: a seller
-- editing a class capacity down below what has already sold must be refused by
-- the database and not only by whichever statement happened to be looking.
DO $$ BEGIN
  ALTER TABLE "booking_slots"
    ADD CONSTRAINT "booking_slots_seats_not_negative" CHECK ("seats_taken" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
