-- Booking: the shop's own clock and working week.
--
-- Written by hand rather than generated, because it had to be applied to a
-- live database in a hurry: the schema change shipped ahead of it and every
-- shop page began failing with `column "time_zone" does not exist`. Drizzle
-- selects every column its schema declares, so one column the database has
-- never heard of breaks every query against that table.
--
-- Additive and idempotent. Nothing is dropped, no existing row is rewritten,
-- and running it twice is a no-op — `db:push` diffs the whole schema, which is
-- more than this needs and more than is safe to point at production while
-- other work is in flight.
--
-- `time_zone` defaults to UTC rather than being nullable: opening hours are
-- meaningless without one, and a null would have to be handled at every read.
-- The other two are genuinely optional — null booking hours means "never
-- configured", which `hoursOf` answers with a sensible default week, and a
-- null slot spacing means the service's own duration sets it.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'UTC';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS booking_hours jsonb;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS booking_slot_minutes integer;
