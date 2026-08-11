-- Two-factor authentication (spec 01) and session geolocation (spec 02).
--
-- The `two_factor` table and `user.two_factor_enabled` mirror what
-- `npx @better-auth/cli generate` emits for better-auth 1.6.25's twoFactor
-- plugin: `secret` and `backup_codes` are stored encrypted with
-- BETTER_AUTH_SECRET, `verified` stays false until the first TOTP code proves
-- the authenticator holds the secret, and `failed_verification_count` /
-- `locked_until` are the plugin's database-backed account lockout.
--
-- `session.city` / `session.country` are written once at session creation from
-- Vercel's per-request geo headers (x-vercel-ip-city / x-vercel-ip-country) —
-- stored because the headers describe only the current request, and the
-- sessions table has to answer for sign-ins that happened weeks ago. Nullable:
-- rows from before this migration, and local dev, have nothing truthful to say.

CREATE TABLE IF NOT EXISTS "two_factor" (
  "id" text PRIMARY KEY,
  "secret" text NOT NULL,
  "backup_codes" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "verified" boolean NOT NULL DEFAULT true,
  "failed_verification_count" integer NOT NULL DEFAULT 0,
  "locked_until" timestamp
);

CREATE INDEX IF NOT EXISTS "two_factor_user_id_idx" ON "two_factor" ("user_id");
CREATE INDEX IF NOT EXISTS "two_factor_secret_idx" ON "two_factor" ("secret");

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "city" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "country" text;
