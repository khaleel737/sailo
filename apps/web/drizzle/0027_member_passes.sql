-- Member passes: what a member shows at the door.
--
-- Memberships have been billing-complete since 0017/0018 — card and manual
-- rails, trials, grace, renewals, cancellation — and have never had an access
-- half. `membershipAccess` decides "open right now" correctly and the only
-- thing that ever asks it is a file download. A gym, a class studio and a
-- co-working desk are the memberships people actually sell, and all three
-- need the other question answered: this person is standing here, may they
-- come in?
--
-- Tickets cannot do this job. A ticket is one admission and burns itself
-- (`valid` -> `used`), which is right for an event and wrong for a member who
-- turns up ninety times a year. A pass is the opposite: it never burns, and
-- every scan re-asks the subscription whether it is still open.
--
-- Entirely additive. One nullable column and one new table, so it is safe to
-- apply ahead of the code that reads it — until a pass is minted the column is
-- null everywhere and the door finds nothing, which is exactly what the door
-- does today.

-- The member's durable code. Nullable because every existing subscription
-- predates this and because a manual membership that has never activated has
-- nothing to admit; `ensureMemberPass` mints on demand rather than backfilling
-- a credential for members who may never scan one.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pass_code" text;

-- Unique across the platform, not per shop, and plain rather than partial.
--
-- Plain for the reason the note on subscriptions_stripe_key gives at length:
-- Postgres already allows any number of NULLs under a unique index, and a
-- partial one cannot be inferred by ON CONFLICT unless every upsert repeats
-- its predicate — which is how that index broke every card membership with
-- 42P10 the first time it was written. Global rather than per-shop because the
-- door resolves a scanned code before it knows which membership it belongs to,
-- and a code that means two things in two shops is a code that admits the
-- wrong person the day a seller runs two gyms.
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_pass_code_key"
  ON "subscriptions" ("pass_code");

-- Attendance. One row per admission, append-only.
--
-- Deliberately not a counter on `subscriptions`. A counter answers "how many
-- times" and nothing else, and the questions a gym actually has are "who came
-- this week", "is this member still using it" and "was that scan mine or the
-- evening volunteer's" — none of which a number can answer, and all of which
-- are one row each. It is also the record that makes a disputed cancellation
-- arguable: a member claiming they never used the place has a row per visit
-- saying otherwise.
CREATE TABLE IF NOT EXISTS "member_checkins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,

  -- CASCADE: attendance without a subscription is a row nobody can interpret.
  -- Unlike an order, this documents no money and holds no retention duty.
  "subscription_id" uuid NOT NULL
    REFERENCES "subscriptions"("id") ON DELETE CASCADE,

  -- Which membership admitted them, snapshotted off the subscription at scan
  -- time. SET NULL rather than CASCADE — a seller deleting the product has not
  -- un-happened anybody's visit, and the attendance history is the thing this
  -- table exists to keep.
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,

  -- The door pass that scanned, exactly as tickets.checked_in_by records it.
  -- Null is the owner in person.
  "checked_in_by" text,

  "created_at" timestamp DEFAULT now() NOT NULL
);

-- The seller's question: this shop's attendance, newest first. Also the
-- window the double-scan guard reads — "has this member already been admitted
-- in the last few minutes" — which is why subscription_id leads.
CREATE INDEX IF NOT EXISTS "member_checkins_subscription_idx"
  ON "member_checkins" ("subscription_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "member_checkins_shop_idx"
  ON "member_checkins" ("shop_id", "created_at" DESC);
