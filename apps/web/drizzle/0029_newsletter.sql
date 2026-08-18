-- Sailo's own mailing list, and the campaigns sent to it.
--
-- The blog gained a signup form, and there was nowhere to put the addresses.
-- `clients` is a shop's customer and every constraint on it is shop-scoped;
-- `lifecycle_emails` is keyed on `user_id` and so can only reach people who
-- already have an account. A reader who subscribes before signing up — the
-- entire point of writing the blog — fits neither.
--
-- Three tables, mirroring the shop-side broadcast pipeline exactly: the list,
-- the campaign, and one row per address written before anything is sent.
-- Leaving is *not* a column here: an unsubscribe writes `marketing_opt_outs`,
-- which is already keyed on the address and already covers every kind of
-- marketing Sailo sends.
--
-- Safe to re-run: every statement carries IF NOT EXISTS, and the two foreign
-- keys are wrapped so a second pass is a no-op.

CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "locale" text DEFAULT 'en' NOT NULL,
  "source" text DEFAULT 'blog' NOT NULL,
  "source_path" text,
  -- Not null on purpose: a row exists only once a link sent to the address
  -- has been clicked, so there is no such thing as a pending subscriber.
  "confirmed_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscribers_email_key"
  ON "newsletter_subscribers" ("email");
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_confirmed_idx"
  ON "newsletter_subscribers" ("confirmed_at");
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_source_idx"
  ON "newsletter_subscribers" ("source", "confirmed_at");

CREATE TABLE IF NOT EXISTS "newsletters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject" text NOT NULL,
  "preview_text" text,
  "body_markdown" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "audience" text DEFAULT 'all' NOT NULL,
  "cta_label" text,
  "cta_url" text,
  "recipient_count" integer DEFAULT 0 NOT NULL,
  "scheduled_at" timestamp,
  "started_at" timestamp,
  "sent_at" timestamp,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "newsletters_status_idx" ON "newsletters" ("status");
CREATE INDEX IF NOT EXISTS "newsletters_due_idx"
  ON "newsletters" ("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "newsletters_created_idx"
  ON "newsletters" ("created_at");

CREATE TABLE IF NOT EXISTS "newsletter_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "newsletter_id" uuid NOT NULL,
  "subscriber_id" uuid,
  "email" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "provider_id" text,
  "error" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "newsletter_deliveries"
    ADD CONSTRAINT "newsletter_deliveries_newsletter_id_newsletters_id_fk"
    FOREIGN KEY ("newsletter_id") REFERENCES "newsletters"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- `set null` and not `cascade`: a subscriber deleted under a GDPR erasure
-- must not take the record of a send with them. The address on the row is
-- what was mailed, and that is a fact about our own sending rather than
-- personal data we are keeping about them.
-- Named short rather than in drizzle's `<table>_<column>_<ref>_<refcol>_fk`
-- convention, which for these two table names is 64 characters. Postgres caps
-- an identifier at 63 and truncates silently, so the long form would leave the
-- database holding a constraint whose name is not the one this file asks for —
-- and every future reader diffing the two would find a discrepancy that is
-- really just a truncation.
DO $$ BEGIN
  ALTER TABLE "newsletter_deliveries"
    ADD CONSTRAINT "newsletter_deliveries_subscriber_id_fk"
    FOREIGN KEY ("subscriber_id") REFERENCES "newsletter_subscribers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One address is mailed once per campaign, decided by Postgres rather than by
-- the loop that builds the queue.
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_deliveries_target_key"
  ON "newsletter_deliveries" ("newsletter_id", "email");
CREATE INDEX IF NOT EXISTS "newsletter_deliveries_queue_idx"
  ON "newsletter_deliveries" ("newsletter_id", "status");
CREATE INDEX IF NOT EXISTS "newsletter_deliveries_provider_idx"
  ON "newsletter_deliveries" ("provider_id");
CREATE INDEX IF NOT EXISTS "newsletter_deliveries_sent_idx"
  ON "newsletter_deliveries" ("sent_at");
