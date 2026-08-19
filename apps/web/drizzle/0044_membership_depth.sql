-- Spec 49 — membership depth: fixed terms, cancellation policy, pause, seats,
-- dunning, upgrade paths.
--
-- Memberships were billing-complete and product-incomplete: every column here
-- is something a member or a seller asks for in the first month of selling one.
--
-- Every column is nullable or carries the default that reproduces today's
-- behaviour exactly, and the one new table starts empty. A shop that configures
-- none of this bills, admits and cancels identically the minute after this
-- runs. The `0034` discipline.
--
-- ─── THE CONSTRAINT THE WHOLE SPEC IS WRITTEN UNDER ─────────────────────────
--
-- `membershipAccess` gains **exactly one branch** — "the term is complete and
-- the seller said access continues" — and nothing else forks.
--
-- Its single-implementation property is why the grace rule, the members list,
-- the download gate, the door pass and cancellation all behave consistently
-- today without five copies of the rule drifting apart. `billing_mode` proved
-- that: manual memberships were added and *nothing about access forked*,
-- because the function reads `status` and `current_period_end` and has never
-- known who wrote them. Pause is expressed the same way — see below — rather
-- than as a second predicate.
--
-- ─── 1. FIXED TERM, AND ACCESS AFTER IT ─────────────────────────────────────
--
--   products.term_cycles         NULL is open-ended, which is every membership
--                                that exists today.
--   products.access_after_term   Whether the door stays open once the last
--                                cycle is paid.
--
-- The second half is the interesting one: a fixed-term subscription that keeps
-- access is **a payment plan expressed in a model that already works**, which
-- is how a seller sells a course in three payments without Sailo building an
-- instalments engine — refused on money-path grounds in
-- `GAP-2026-08-easytools.md` §4.7. It has none of the partial-delivery problem
-- either, because access is granted from the first payment either way: a failed
-- third cycle costs the seller a payment rather than leaving an entitlement
-- half-earned.
--
--   subscriptions.cycles_paid    Incremented in the *same conditional UPDATE*
--                                that records the period, beside
--                                `renewal_ordered_for` and
--                                `orders.membership_period_end`. Those columns
--                                exist precisely because a seller toggling an
--                                order paid → unpaid → paid must buy one month
--                                rather than three, and cycle counting has the
--                                identical hazard.
--   subscriptions.term_cycles    Snapshotted at signup, so a seller changing
--                                the product's term next year does not
--                                lengthen or shorten one somebody already
--                                bought.
--   subscriptions.access_after_term  Snapshotted for the same reason, and it is
--                                the flag the one new `membershipAccess` branch
--                                reads.
--   subscriptions.ended_reason   term_complete | canceled | expired | disputed.
--
-- ─── 2. CANCELLATION POLICY ─────────────────────────────────────────────────
--
-- Sailo could only `cancel_at_period_end`. What is missing is the seller's
-- terms and the immediate option.
--
--   products.minimum_term_cycles   Cannot cancel before N cycles.
--   products.cancel_notice_days    Notice runs before the period end.
--   products.cancel_policy_note    Prose, shown at checkout and on cancel.
--
-- **The policy must be disclosed at checkout to be enforceable**, and it feeds
-- `cancellation_policy_disclosure` — a real Stripe evidence field and the thing
-- that decides Visa 13.2. It is snapshotted onto the order through spec 44's
-- `policy_snapshots`, so a dispute five months later cites the terms the member
-- actually saw rather than the ones the seller has since edited.
--
-- **A minimum term does not trap a member on the manual rail.** They can always
-- stop paying; the term governs what the seller may say about it, not a lock.
-- The copy says so rather than implying an obligation Sailo cannot enforce.
--
-- ─── 3. PAUSE / FREEZE ──────────────────────────────────────────────────────
--
--   subscriptions.paused_at / paused_until
--   subscriptions.pause_days_used
--   products.pause_max_days        NULL is pausing not offered — today.
--
-- **`membershipAccess` returns false while paused, and it does so without a
-- second predicate.** A pause moves `current_period_end` forward on resume, and
-- during the pause the row is `paused_until > now` — which the one new branch
-- reads alongside the term flag. A pause that kept access would be a free
-- month, and the whole point is that the member is not using it. The door pass
-- closes with it for free: `checkInMemberByCode` already re-asks
-- `membershipAccess` on every scan.
--
-- On the card rail this is Stripe's `pause_collection` with `behavior: void`
-- and Stripe pushes the clock; on the manual rail the renewal cron skips and
-- the period end moves by the paused days. We do not recompute Stripe's
-- billing clock in either case.
--
-- `pause_max_days` and `pause_days_used` are what stop a rolling permanent
-- pause — a member frozen for ever is a member with a free membership.
--
-- ─── 4. SEATS ───────────────────────────────────────────────────────────────
--
-- The one genuinely new shape here, and what turns a membership into something
-- a *company* buys.
--
--   subscriptions.seats                     The payer's seat count.
--   subscriptions.parent_subscription_id    Reserved for a seat expressed as
--                                           its own subscription row.
--   subscription_seats                      One row per person.
--
-- **The payer holds the billing relationship; each seat holds its own access.**
-- `quantity` on the Stripe subscription is the seat count, so the price is
-- Stripe's arithmetic and not ours.
--
-- **Each seat gets its own `pass_code`.** A shared code for eight employees is
-- one code at the door, which defeats attendance entirely — and the global
-- unique index below is the same guarantee `subscriptions.pass_code` has, for
-- the same reason: the door resolves a scanned code before it knows whose
-- membership it is.
--
-- `membershipAccess` for a seat reads the **parent's** status and period end.
-- One source of truth for whether the money is good; the seat only says who.
--
-- A seat is reached by a signed token like everything else — §4.8 stands, and
-- this is the closest buyer identity has come to needing an account.
--
-- ─── 5. DUNNING ─────────────────────────────────────────────────────────────
--
--   subscriptions.dunning_attempts / dunning_last_sent_at
--
-- Sailo's grace rule is correct and what was missing is **telling anybody**.
-- Each send is *claimed* by conditional UPDATE — the `sellerOpenedNotifiedAt`
-- pattern on `disputes` is the model and the reason is identical: Stripe
-- delivers at least once and out of order.
--
-- The member's email links to **Stripe's own billing portal**. Sailo must not
-- collect a card here; that is the rule that keeps a button from claiming
-- "fixed" while the charge keeps failing.
--
-- ─── 6. UPGRADE PATHS ───────────────────────────────────────────────────────
--
--   subscriptions.pending_product_id / pending_effective_at
--
-- Switching at period end by default: no proration, no surprise invoice.
-- Immediate switching is offered only where Stripe's own proration produces the
-- number — never one Sailo computes.
--
-- Safe to re-run: IF NOT EXISTS throughout.

-- ─── products ───────────────────────────────────────────────────────────────

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "term_cycles" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "access_after_term" boolean DEFAULT false NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "minimum_term_cycles" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cancel_notice_days" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cancel_policy_note" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pause_max_days" integer;

-- ─── subscriptions ──────────────────────────────────────────────────────────

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "cycles_paid" integer DEFAULT 0 NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "term_cycles" integer;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "access_after_term" boolean DEFAULT false NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "ended_reason" text;

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paused_until" timestamp;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pause_days_used" integer DEFAULT 0 NOT NULL;

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "seats" integer DEFAULT 1 NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "parent_subscription_id" uuid;

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "dunning_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "dunning_last_sent_at" timestamp;

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pending_product_id" uuid;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pending_effective_at" timestamp;

-- Self-referencing, so it cannot be declared inline above without the table
-- having to exist first. Guarded rather than IF NOT EXISTS because Postgres has
-- no such form for a foreign key.
DO $$ BEGIN
  ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_parent_fk"
    FOREIGN KEY ("parent_subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_pending_product_fk"
    FOREIGN KEY ("pending_product_id") REFERENCES "products"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The switch sweep's own question: which subscriptions have a switch due.
-- Partial, because a scheduled switch is a handful of rows in a table of
-- members and an index over mostly-NULL is mostly waste.
CREATE INDEX IF NOT EXISTS "subscriptions_pending_switch_idx"
  ON "subscriptions" ("pending_effective_at")
  WHERE "pending_product_id" IS NOT NULL;

-- The resume sweep's: which paused memberships are due back.
CREATE INDEX IF NOT EXISTS "subscriptions_paused_idx"
  ON "subscriptions" ("paused_until")
  WHERE "paused_until" IS NOT NULL;

-- ─── subscription_seats ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "subscription_seats" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "subscription_id" uuid NOT NULL REFERENCES "subscriptions"("id") ON DELETE CASCADE,
  -- Folded to lowercase by the writer, because the unique index below is what
  -- stops one employee being invited twice under two spellings.
  "email"           text NOT NULL,
  "name"            text,
  -- Its own credential. A shared code for eight employees is one code at the
  -- door, and attendance stops meaning anything.
  "pass_code"       text,
  "invited_at"      timestamp NOT NULL DEFAULT now(),
  "accepted_at"     timestamp,
  "revoked_at"      timestamp,
  "created_at"      timestamp NOT NULL DEFAULT now(),
  UNIQUE ("subscription_id", "email")
);

/*
 * Global rather than per-subscription, exactly as `subscriptions_pass_code_key`
 * is, and for the identical reason: the door resolves a scanned code *before*
 * it knows whose membership it is, so a code meaning one thing in one shop and
 * another somewhere else admits the wrong person the day a seller opens a
 * second gym.
 */
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_seats_pass_code_key"
  ON "subscription_seats" ("pass_code");

CREATE INDEX IF NOT EXISTS "subscription_seats_subscription_idx"
  ON "subscription_seats" ("subscription_id", "invited_at");
