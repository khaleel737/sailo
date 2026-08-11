-- Checkout compliance: terms agreement and marketing consent (spec 05).
--
-- Both switches default off. A shop that never opens the setting must keep
-- checking out exactly as it did yesterday — turning compliance on is a
-- deliberate act by a seller who has terms to point at, not something a
-- migration decides for them.
--
-- The two proofs are timestamps rather than booleans because that is what an
-- audit asks for: not whether this buyer agreed, but when. `terms_accepted_at`
-- is written server-side at order creation from the server's own clock, never
-- from a flag the client can resubmit later. `marketing_consent_at` follows a
-- grant-only merge (`lib/orders/clients.ts`) — a later order that leaves the
-- optional box empty is a buyer who skipped a box, not one who withdrew, and
-- withdrawal is its own path (unsubscribe, spec 14).

ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "require_terms" boolean NOT NULL DEFAULT false;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "terms_url" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "ask_marketing_consent" boolean NOT NULL DEFAULT false;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp;

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "marketing_consent_at" timestamp;
