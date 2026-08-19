-- Spec 07 — a product whose checkout is a form.
--
-- One new table and one new column. Nothing existing is rewritten and no
-- existing row changes meaning, so a catalogue that has never seen a lead
-- magnet reads and sells identically the moment this lands.
--
-- WHY A KIND AND NOT A PRICE OF ZERO
--
-- `products.kind` gains `lead`. It could have been an ordinary product priced
-- at zero, and that would have been wrong in a way that only shows up in the
-- accounts: a zero-value order still takes an invoice number out of a sequence
-- a tax authority expects to describe actual trade, still appears in revenue
-- rollups as a sale, and still reserves stock. A lead is none of those things.
-- The kind is what lets every one of those paths exclude it explicitly rather
-- than by everyone remembering to filter on an amount.
--
-- There is no CHECK constraint on `kind` and this file does not add one — the
-- column has always been free text validated by `isProductKind` in
-- `@sailo/core/variants`, and adding a constraint now would be a change to
-- every other kind's write path for no benefit to this one.
--
-- WHY THE UNIQUE INDEX IS ON THE ADDRESS AND NOT ON THE CONTACT
--
-- A resubmission has to update rather than duplicate — spec 07 says so, and a
-- seller counting leads needs the number to be people rather than clicks.
-- `client_id` cannot carry that: it is nullable (a deleted contact sets it
-- null, so the record survives without staying attributable), and Postgres
-- treats two NULLs in a unique index as distinct, so a shop that had deleted
-- two contacts could collect the same lead twice. The address is the stable
-- identity, and it is stored **folded** — unlike `clients.email`, which keeps
-- the casing the buyer typed because it is shown back to a seller and mailed
-- to. This one exists only to be matched, so folding it at the write makes
-- `Ada@x.com` and `ada@x.com` one person and keeps the unique index a plain
-- one rather than an expression index.
--
-- Safe to re-run: IF NOT EXISTS throughout, and the table's foreign keys are
-- declared inline where the table is created.

CREATE TABLE IF NOT EXISTS "leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  -- `set null`, not cascade: the seller's own count of how many people asked
  -- for a thing must survive one of them being deleted. See the header.
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "email" text NOT NULL,
  "name" text,
  -- Each answer carries the question as it was worded at the time, so renaming
  -- a question does not silently relabel every answer already given.
  "answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "leads_shop_created_idx" ON "leads" ("shop_id", "created_at");
CREATE INDEX IF NOT EXISTS "leads_product_idx" ON "leads" ("product_id");
CREATE UNIQUE INDEX IF NOT EXISTS "leads_product_email_key" ON "leads" ("product_id", "email");

-- The seller's questions. Empty for every product that exists, which is what
-- makes this column inert until somebody builds a form.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lead_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;

-- The magnet, when the product has files to hand over.
--
-- A token of the lead's own rather than the order download token spec 07
-- imagined reusing. `/download/[token]` resolves an *order*: it renders
-- tickets, event join links and membership state, and it writes
-- `download_events` because a download is the whole of a digital sale's
-- chargeback evidence. A lead has none of that and must never acquire it, so
-- reusing that gate would mean giving every one of those lines a second
-- meaning. Two columns here are cheaper, and they keep the money path exactly
-- as it is.
--
-- Hashed, never plain: this is a bearer credential to somebody's file, and a
-- database read must not hand out live links. The same rule `door_passes` and
-- the broadcast tokens follow. Revoking one is deleting the lead.
--
-- The cap and the expiry are the product's own `download_limit` and
-- `download_expiry_days`, so a magnet is configured exactly as a paid download
-- is, with no second set of controls to keep in step.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "magnet_token_hash" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "magnet_expires_at" timestamp;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "magnet_downloads" integer DEFAULT 0 NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "leads_magnet_token_key"
  ON "leads" ("magnet_token_hash") WHERE "magnet_token_hash" IS NOT NULL;
