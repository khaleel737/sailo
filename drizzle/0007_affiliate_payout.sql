-- Affiliates tell the seller where their commission should go.
--
-- Set from the partner portal (token-authed), read in the seller's admin next
-- to what they owe. `payout_updated_at` exists for the attack the portal's
-- threat model actually has — a leaked link being used to quietly point the
-- money somewhere else — every change stamps it, mails the affiliate, and
-- surfaces as a seller notification.

ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "payout_method" text;
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "payout_details" text;
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "payout_updated_at" timestamp;
