-- Where to reach a seller's phone: Expo push tokens, one row per device.
--
-- Entirely additive. A new table, referencing "user" and touching nothing that
-- already exists, so it is safe to apply ahead of the code that reads it —
-- until the mobile app registers a token the table is empty, and an empty table
-- means the push branch in `lib/orders/notify-seller.ts` finds no devices and
-- sends nothing. The seller's email is unaffected either way.
--
-- Rolling back is a DROP TABLE and costs a re-registration, which every device
-- performs on next launch.

CREATE TABLE IF NOT EXISTS "push_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- text, not uuid: better-auth owns "user" and its ids are its own format.
  -- CASCADE because a deleted account must not leave a live address behind —
  -- account deletion is a promise about reachability as much as about rows.
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,

  -- Expo's routing address for one device. Not a credential: it grants nothing
  -- here and reads nothing. See the note in packages/db/src/schema/push.ts.
  "token" text NOT NULL,

  -- ios | android
  "platform" text NOT NULL,

  "created_at" timestamp DEFAULT now() NOT NULL,
  -- Bumped every time the device re-announces itself, which is every launch it
  -- has permission for. The only evidence we have that a device still exists.
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Unique on the token alone, NOT on (user_id, token).
--
-- This is the constraint the feature turns on, so it is worth stating plainly:
-- a handset that changes hands reports the same token under a new user, and a
-- composite key would keep both rows — pushing the new seller's orders to the
-- old seller's lock screen. Uniqueness here makes that second registration
-- collide, and the upsert in `push.register` moves the row to whoever is
-- signed in now. One device, one row.
CREATE UNIQUE INDEX IF NOT EXISTS "push_tokens_token_key" ON "push_tokens" ("token");

-- The read on the send path: every device belonging to one seller.
CREATE INDEX IF NOT EXISTS "push_tokens_user_id_idx" ON "push_tokens" ("user_id");
