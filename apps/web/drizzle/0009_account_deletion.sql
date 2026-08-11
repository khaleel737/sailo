-- Self-serve account deletion (spec 03).
--
-- Deletion anonymises the ledger rather than dropping it: orders, invoices and
-- refunds document real money movement and a per-shop invoice sequence a tax
-- authority expects unbroken, so the `shops` row survives as the retention
-- container (tombstoned, unpublished, handle released). `deleted_at` is what
-- separates that tombstone from a live shop — every public query path excludes
-- it the way `suspended_at` is excluded.

ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
