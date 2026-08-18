-- The documents a dispute is answered with.
--
-- `0024_disputes.sql` gave a dispute everything except the one thing a
-- `product_not_received` case is actually decided on: the carrier's proof of
-- delivery. The evidence assembler already reported it as an outstanding ask and
-- `respondToDispute` already accepted file ids — there was simply nowhere in the
-- product to put a file, so every file field was permanently blocked.
--
-- One row per (dispute, field), enforced by Postgres rather than by the
-- application, because Stripe's evidence object has exactly one slot per field:
-- two rows for `customer_communication` would submit one and silently drop the
-- other, and nothing would record which. The seller with three screenshots has
-- to combine them, and the unique index is what makes the product tell them so
-- instead of losing two of the three.
--
-- Additive and safe to apply ahead of the code that reads it: a dispute with no
-- rows here behaves exactly as it did before, which is to say the file fields
-- read as not held.

CREATE TABLE IF NOT EXISTS "dispute_evidence_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dispute_id" uuid NOT NULL,
  "field" text NOT NULL,
  "stripe_file_id" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "bytes" integer NOT NULL,
  "uploaded_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "dispute_evidence_files"
    ADD CONSTRAINT "dispute_evidence_files_dispute_id_fk"
    FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- One document per evidence field, per dispute. See above: this is the
-- constraint that turns a silent overwrite into a message.
CREATE UNIQUE INDEX IF NOT EXISTS "dispute_evidence_files_field_key"
  ON "dispute_evidence_files" ("dispute_id", "field");

CREATE INDEX IF NOT EXISTS "dispute_evidence_files_dispute_idx"
  ON "dispute_evidence_files" ("dispute_id");
