-- The partner programme becomes a seller programme, and gets much smaller.
--
-- Two decisions, one consequence.
--
-- The first: a partner must be an active paying seller, the way Stan requires
-- an active Stan subscription. That is a commercial choice — the programme is
-- now a reason to stay subscribed rather than a way for outsiders to earn.
--
-- The second follows from it and is why this migration deletes rather than
-- adds. If every partner is a paying seller, every partner already has a
-- Stripe account connected: the one their own buyers pay into. So commission
-- goes *there*, and the entire apparatus for paying somebody who had no
-- account of their own stops having anything to do.
--
-- What that apparatus was, all added in 0015 and 0021's earlier draft:
--
--   * six columns mirroring a second Stripe account per partner,
--   * a transfers-only `recipient` account under a different service
--     agreement, with the country rules that agreement carries,
--   * a 35-country picker, and a cross-border zone gating payouts against it,
--   * bank/PayPal details plus a hand-payment path for everyone that missed.
--
-- None of it is reachable now. A seller who cannot be paid by Stripe cannot
-- sell on Sailo either, so there is no partner left who needs a fallback.
--
-- Nothing about the *ledger* changes. `referral_earnings`, the 30% rate, the
-- hold, the reversal-on-refund and the payout idempotency are all untouched —
-- this only changes where a transfer is addressed.

/* -------------------------------------------------------------------------- */
/*  The partner's own Stripe account, no longer used                           */
/* -------------------------------------------------------------------------- */

-- Dropped rather than left in place. A column nobody writes and one reader
-- forgets to stop reading is how a payout silently addresses itself to a
-- disconnected account; there is no half-measure here worth keeping.
ALTER TABLE "partners" DROP COLUMN IF EXISTS "stripe_account_id";
ALTER TABLE "partners" DROP COLUMN IF EXISTS "stripe_transfers_enabled";
ALTER TABLE "partners" DROP COLUMN IF EXISTS "stripe_details_submitted";
ALTER TABLE "partners" DROP COLUMN IF EXISTS "stripe_account_country";
ALTER TABLE "partners" DROP COLUMN IF EXISTS "stripe_connected_at";

-- From the manual-payout draft that this supersedes. Present only on
-- databases that ran it; `IF EXISTS` makes both cases the same migration.
ALTER TABLE "partners" DROP CONSTRAINT IF EXISTS "partners_payout_method_known";
ALTER TABLE "partners" DROP CONSTRAINT IF EXISTS "partners_payout_details_paired";
DROP INDEX IF EXISTS "partners_manual_payout_idx";
ALTER TABLE "partners" DROP COLUMN IF EXISTS "payout_method";
ALTER TABLE "partners" DROP COLUMN IF EXISTS "payout_details";
ALTER TABLE "partners" DROP COLUMN IF EXISTS "payout_updated_at";

/* -------------------------------------------------------------------------- */
/*  A partner is a seller                                                      */
/* -------------------------------------------------------------------------- */

-- `shop_id` was nullable so a newsletter writer with no shop could be a
-- partner. That is exactly what the subscription requirement rules out, and a
-- partner with no shop now has no account to be paid into — an unpayable row
-- waiting to be discovered by whoever is owed money.
--
-- Any such partner is un-approved rather than deleted. Their referrals and
-- their ledger are real and stay linked; what they lose is the ability to
-- accrue more, which is the same thing that happens to a seller who cancels.
UPDATE "partners" SET
  "status" = 'suspended',
  "review_note" = 'The partner programme now requires an active Sailo subscription.'
WHERE "shop_id" IS NULL AND "status" = 'approved';

-- The payout run reads shop-by-partner on every pass.
CREATE INDEX IF NOT EXISTS "partners_shop_payable_idx"
  ON "partners" ("shop_id")
  WHERE "shop_id" IS NOT NULL AND "status" = 'approved';
