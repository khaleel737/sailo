-- Moving a catalogue in from somewhere else — spec 47.
--
-- Two tables, and the second is the one that matters.
--
-- `import_links` is what makes re-running an import an **update rather than a
-- duplicate**. A seller who imports 200 Shopify products, fixes three prices in
-- Shopify and imports again must end with 200 products. Without this they get
-- 400, and the second run is the one that loses their trust permanently.
--
-- The primary key is the identity — (shop, source, entity, external_id) — so
-- one external object maps to one local row and the constraint decides it
-- rather than a lookup that races two concurrent jobs.
--
-- WHAT IS DELIBERATELY ABSENT
--
-- **Orders.** Nothing here records a sale, and no future column should.
-- `invoices` is a numbered sequence a tax authority expects unbroken and
-- `invoice_next_number` is claimed per order, so importing 4,000 historical
-- Shopify orders would either claim 4,000 numbers for sales Sailo did not make
-- or write orders with no invoice and break what the sequence means. They would
-- also enter revenue rollups, the dispute-rate denominator and every analytics
-- tile — all of which would then describe a period Sailo was not the merchant
-- for. A seller who wants their history gets a read-only archive, which is a
-- different table and a different spec.
--
-- **Credentials.** Shopify needs an API token; it is taken in the form, held
-- for the job and discarded. A stored third-party token is a credential at rest
-- with no ongoing purpose — the import is a one-off errand, and a seller who
-- wants to re-run it can paste it again. This is the opposite of spec 31's
-- `integration_apps`, deliberately: that one is a connection, this one is an
-- errand, and continuous sync is a different spec with a different security
-- posture that must not be smuggled in through this one.
--
-- `local_id` is **not** a foreign key. It points at whichever table `entity`
-- names — products, variants, categories, clients — and a polymorphic column
-- cannot be constrained to four parents at once. A link whose target has been
-- deleted reads as "create it again", which is what a seller who deleted a
-- product and re-imported actually wants.
CREATE TABLE IF NOT EXISTS "import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL,
  -- stripe | shopify | etsy | gumroad | csv
  "source" text NOT NULL,
  -- products | customers. Never `orders`; see above.
  "kind" text DEFAULT 'products' NOT NULL,
  -- draft | previewed | running | done | failed | cancelled
  "status" text DEFAULT 'draft' NOT NULL,
  -- { found, created, updated, skipped, failed }. Kept beside `report` rather
  -- than derived from it: the report is capped and the counts are not, and
  -- deriving totals from a truncated list is how a silent cap gets reported as
  -- a complete run.
  "counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Per-row verdicts and reasons, capped. A silent partial import is worse
  -- than a failure, so every skip and every failure is in here and the seller
  -- can download the lot.
  "report" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" text,
  "started_at" timestamp,
  "finished_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "import_jobs"
    ADD CONSTRAINT "import_jobs_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "import_jobs_shop_idx"
  ON "import_jobs" ("shop_id", "created_at");

-- One job at a time, decided by the database rather than by a read.
--
-- Two simultaneous imports of the same catalogue race on `import_links`: both
-- plan against a shop with no links, both decide every row is a create, and the
-- seller ends with two of everything. A lookup before the insert has a window
-- exactly where that matters, so the claim is the insert — a second job under
-- the same shop violates this index and is refused.
--
-- Partial on `status = 'running'`, so a shop's finished jobs stay in the table
-- as the history they are.
CREATE UNIQUE INDEX IF NOT EXISTS "import_jobs_one_running_idx"
  ON "import_jobs" ("shop_id")
  WHERE "status" = 'running';

CREATE TABLE IF NOT EXISTS "import_links" (
  "shop_id" uuid NOT NULL,
  "source" text NOT NULL,
  -- product | variant | category | client
  "entity" text NOT NULL,
  -- The id the source uses: Stripe's `prod_…`, Shopify's gid, Etsy's listing id.
  "external_id" text NOT NULL,
  "local_id" uuid NOT NULL,
  "first_imported_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "import_links_pkey"
    PRIMARY KEY ("shop_id", "source", "entity", "external_id")
);

DO $$ BEGIN
  ALTER TABLE "import_links"
    ADD CONSTRAINT "import_links_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Answers "what did this product come from", which the admin shows on a
-- re-imported row and the writer asks when a link's target has been deleted.
CREATE INDEX IF NOT EXISTS "import_links_local_idx"
  ON "import_links" ("shop_id", "local_id");
