-- Lifecycle email: Sailo's own marketing pipeline to the people who signed up.
--
-- Two new tables and nothing else. Purely additive — no column is added to a
-- table that already exists, nothing is rewritten, and a deployment that never
-- runs the cron behaves exactly as it did before.
--
-- Note what is *not* here: there is no `onboarding_stage` column on `user` or
-- `shops`. Which email a seller is due is derived at send time from the shop,
-- product, payment-rail and order rows that already exist, the same way the
-- dashboard's setup checklist derives its ticks. A stored stage is a second
-- answer to a question the data already answers, and the two drift the first
-- time a product is deleted or a rail is switched off.

/* -------------------------------------------------------------------------- */
/*  1. What has been sent                                                      */
/* -------------------------------------------------------------------------- */

-- One row per lifecycle email per user, written *before* the send.
--
-- The claim is the INSERT, exactly as in `event_reminders`. Two overlapping
-- cron ticks, a retry, a hand-run while debugging, or two regions firing at
-- once produce one row between them, and only the caller that gets a row back
-- from `ON CONFLICT DO NOTHING RETURNING` may send. Nothing reads to decide
-- whether to write.
--
-- A failed send keeps its claim rather than releasing it. "Retried" and "sent
-- twice" are indistinguishable when the failure was in the provider's reply
-- rather than in the delivery, and a seller who missed one nudge is a smaller
-- harm than one who got it twice and pressed "report spam" on the domain that
-- carries every other seller's order confirmations. `error` is why, so a miss
-- is visible rather than silent.
CREATE TABLE IF NOT EXISTS "lifecycle_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  /** Which rung of the ladder — see LIFECYCLE_STEPS in lib/lifecycle/steps.ts. */
  "step" text NOT NULL,
  /** Snapshotted: the address that was mailed is a different fact from the
      account's current address. */
  "email" text NOT NULL,
  /** Resend's id. How a bounce finds its way back to this row. */
  "provider_id" text,
  "error" text,
  /** Null until Resend accepts it. A claim is not a delivery. */
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "lifecycle_emails" ADD CONSTRAINT "lifecycle_emails_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;

-- One send per user per step, decided by Postgres and not by the loop that
-- builds the pass. The only thing standing between a replay and a seller being
-- told twice that their shop is live.
CREATE UNIQUE INDEX IF NOT EXISTS "lifecycle_emails_user_step_key"
  ON "lifecycle_emails" USING btree ("user_id", "step");

-- The pacing read: "when did this user last hear from us". Ordered by
-- `created_at` and not `sent_at`, because a claim that failed to send still
-- spent its slot — it is never retried, so treating it as free would let a run
-- of provider failures stack four emails into one afternoon the moment the
-- provider recovered.
CREATE INDEX IF NOT EXISTS "lifecycle_emails_user_created_idx"
  ON "lifecycle_emails" USING btree ("user_id", "created_at");

-- The platform's daily ceiling counts across every user at once.
CREATE INDEX IF NOT EXISTS "lifecycle_emails_sent_idx"
  ON "lifecycle_emails" USING btree ("sent_at");

-- How a bounce gets from Resend's payload back to an address of ours.
CREATE INDEX IF NOT EXISTS "lifecycle_emails_provider_idx"
  ON "lifecycle_emails" USING btree ("provider_id");

/* -------------------------------------------------------------------------- */
/*  2. Who has said no                                                         */
/* -------------------------------------------------------------------------- */

-- Addresses Sailo may never send marketing to again.
--
-- Keyed on the address and not the user, for the same reason
-- `email_suppressions` is: a one-click unsubscribe arrives from a mail client
-- with no session and no user id, a bounce arrives from Resend naming only an
-- address, and both must outlive the account. Somebody who unsubscribes,
-- deletes their account and signs up again a year later has still told us no.
--
-- `reason` is not decoration. An `unsubscribed` row may be lifted again from
-- Settings — that is a person changing their mind about their own inbox. A
-- `bounced` or `complained` row may not: those are facts about deliverability,
-- and letting a seller switch marketing back on for an address that reported
-- us as spam trades every other seller's mail for one seller's preference.
CREATE TABLE IF NOT EXISTS "marketing_opt_outs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  /** Always lower-cased on the way in. */
  "email" text NOT NULL,
  /** unsubscribed | bounced | complained */
  "reason" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Unsubscribing twice is not an error, and the second click comes from
-- somebody already annoyed enough to be clicking it twice.
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_opt_outs_email_key"
  ON "marketing_opt_outs" USING btree ("email");

/* -------------------------------------------------------------------------- */
/*  3. No new index on products or orders                                      */
/* -------------------------------------------------------------------------- */

-- Noted rather than added, because the obvious move here is wrong. The
-- candidate query asks, per user, "how many products does this shop have and
-- when was the first one" — a MIN and a COUNT scoped to one `shop_id`, which
-- `products_shop_idx` already serves, over the tens of rows a single shop
-- holds. `orders` likewise has `orders_shop_created_idx`. A (shop_id,
-- created_at) index on products would earn nothing the existing one doesn't
-- and would be paid for on every product a seller ever saves.
