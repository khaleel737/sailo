-- Seller notification preferences (spec 04).
--
-- `{}` means "everything on": absence of a key is opt-in, so a new event type
-- ships enabled for every existing shop without a backfill. Keys are validated
-- with zod on write (`lib/notification-prefs.ts`) — unknown keys are rejected,
-- so the column can only ever hold booleans the code knows about.

ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "notification_prefs" jsonb NOT NULL DEFAULT '{}'::jsonb;
