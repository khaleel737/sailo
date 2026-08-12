-- Memberships on every rail, not just card.
--
-- 0017 built the card version: Stripe holds a card, raises an invoice each
-- period, charges it, and tells us. That is the version most of this product's
-- sellers cannot use. A gym collecting cash at the door, a class settling by
-- bank transfer, a club that arranges everything over WhatsApp — none of them
-- can take a recurring card payment, and all of them have members.
--
-- So Sailo runs the cycle instead: it raises the next period's order before
-- the current one lapses, the buyer pays it however that shop takes money, and
-- the seller confirming that payment is what extends the membership.
--
-- Nothing about *access* changes. `membershipAccess` reads `status` and
-- `current_period_end` and has never known who wrote them, which is why this
-- migration adds columns and changes no rule.

/* -------------------------------------------------------------------------- */
/*  Who runs the renewal cycle                                                 */
/* -------------------------------------------------------------------------- */

-- `stripe` or `manual`. Defaulted to `stripe` so every row 0017 wrote keeps
-- meaning exactly what it meant.
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "billing_mode" text DEFAULT 'stripe' NOT NULL;

-- The rail a manual member pays on, so a renewal can be raised on the same one
-- they chose with the same instructions they were given the first time.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "payment_method" text;

-- The period a renewal order has already been raised for. The claim that stops
-- two overlapping cron ticks asking one member twice for the same month.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "renewal_ordered_for" timestamp;

/* -------------------------------------------------------------------------- */
/*  A membership without a Stripe object behind it                             */
/* -------------------------------------------------------------------------- */

-- There is no Stripe subscription for somebody who pays cash, so the column
-- has to admit NULL. Dropping NOT NULL is safe in both directions: every
-- existing row has a value, and nothing reads the column without checking the
-- billing mode first.
ALTER TABLE "subscriptions" ALTER COLUMN "stripe_subscription_id" DROP NOT NULL;

-- The unique index is left exactly as 0017 made it. Postgres already allows
-- any number of NULLs under a plain unique index, so nothing about it needs to
-- change for a nullable column — and making it partial would have cost a real
-- trap: `ON CONFLICT` cannot infer a partial index unless every upsert repeats
-- its predicate, and the one that forgets fails with 42P10 on every write.

-- Which period a manual membership payment bought. The idempotency marker for
-- the one path with no webhook behind it: a seller confirming money by hand.
-- Not `stripe_invoice_id` with a made-up value — that column means "Stripe
-- raised this", and a row where it means something else is a row every future
-- reader has to be warned about.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "membership_period_end" timestamp;

-- The renewal cron's question, fleet-wide: which manual memberships are coming
-- up for payment. Without it every tick reads every subscription on the
-- platform to find the handful that are due.
CREATE INDEX IF NOT EXISTS "subscriptions_due_idx"
  ON "subscriptions" ("billing_mode", "status", "current_period_end");
