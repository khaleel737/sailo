-- Spec 52 — a buyer asks what a shop holds about them, and gets an answer.
--
-- Two things, and the order they are built in is not arbitrary.
--
-- ─── 1. THE SWEEP, WHICH COMES FIRST ────────────────────────────────────────
--
-- `README.md` lists it under "Not built yet": the 90-day sweep for a deleted
-- seller's product files. `deleteAccountFor` removes their images at once and
-- deliberately keeps the files, and the cron that finally clears them has been a
-- TODO in `api/cron/sweep` since spec 03 shipped.
--
-- That is personal data with **no deletion path at all**, and this migration is
-- about to promise a statutory one. Shipping erasure on top of a store that
-- cannot actually erase is a promise worse than not making it.
--
-- `shops.files_swept_at` is the claim. A conditional UPDATE with the ceiling in
-- the WHERE — `deleted_at < now() - 90 days AND files_swept_at IS NULL` — so two
-- overlapping cron ticks list a shop's blobs once rather than twice.
--
-- Worth writing down, because it changes what the sweep can even look at:
-- `hardDeleteShopContent` deletes `products`, and `product_files` cascades with
-- them. So by the time a shop is 90 days dead there is usually **no row naming
-- the blobs at all** — they are unreferenced objects in Vercel Blob and the only
-- thing that can still find them is their path, `shops/<shop_id>/downloads/…`.
-- The sweep therefore lists by prefix and treats the store as the source of
-- truth. Any surviving rows are deleted too, but they are the exception.
--
-- ─── 2. THE REQUESTS ────────────────────────────────────────────────────────
--
-- `due_by` is a column and not `requested_at + interval '30 days'` computed at
-- read time, because the clock is the whole point of the feature and the queue
-- sorts on it. It is also set from **verification**, not submission: an
-- unverified request is not yet a request from anybody.

-- ─── The sweep's claim ──────────────────────────────────────────────────────

ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "files_swept_at" timestamp;

-- Partial and tiny: the set of interest is shops that are deleted and not yet
-- swept, which on any real platform is a handful of rows out of every shop that
-- ever existed.
CREATE INDEX IF NOT EXISTS "shops_pending_file_sweep_idx"
  ON "shops" ("deleted_at")
  WHERE "deleted_at" IS NOT NULL AND "files_swept_at" IS NULL;

-- ─── The requests ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "data_requests" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"            uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,

  -- `set null`, not cascade. A request must survive the client row it is about:
  -- fulfilling an erasure is precisely the act that may remove that row, and a
  -- record of the request that disappeared with the data would leave nothing to
  -- show the obligation was met.
  "client_id"          uuid REFERENCES "clients"("id") ON DELETE SET NULL,

  -- The address that asked, which is the only identifier a storefront buyer has
  -- — there are no buyer accounts. Lowercased on the way in.
  "email"              text NOT NULL,

  -- access | erasure | portability
  "kind"               text NOT NULL,

  -- pending | verifying | in_progress | fulfilled | refused | withdrawn
  "status"             text NOT NULL DEFAULT 'pending',

  -- The hash, never the token. The token is mailed to the address and exists
  -- nowhere else; a stored token is a deletion primitive sitting in a table.
  "verify_token_hash"  text,
  "verified_at"        timestamp,

  "requested_at"       timestamp NOT NULL DEFAULT now(),
  -- Set when the address is verified, to verification + 30 days. Null until
  -- then, which is what keeps unverified noise out of the seller's queue.
  "due_by"             timestamp,
  "fulfilled_at"       timestamp,

  -- From a picklist, never free text. "A refusal is an answer", and an answer
  -- a seller invents on the spot is not one that can be reviewed.
  "refused_reason"     text,

  -- Where the assembled export is, and when it stops being anywhere. An
  -- orphaned personal-data export in Blob is the incident this feature exists
  -- to prevent.
  "export_blob_key"    text,
  "export_expires_at"  timestamp,

  -- The seller's address, or 'sailo:staff:<address>' when HQ acted. HQ must not
  -- be able to answer on a seller's behalf without recording that it did.
  "actor"              text,

  "created_at"         timestamp NOT NULL DEFAULT now()
);

-- The queue: this shop's live requests, soonest deadline first.
CREATE INDEX IF NOT EXISTS "data_requests_shop_due_idx"
  ON "data_requests" ("shop_id", "status", "due_by");

-- One live request per address per kind. A buyer may not open forty; a buyer
-- whose request was fulfilled may open another, which is their right — so the
-- constraint is partial over the live statuses rather than over the table.
CREATE UNIQUE INDEX IF NOT EXISTS "data_requests_live_key"
  ON "data_requests" ("shop_id", "email", "kind")
  WHERE "status" IN ('pending', 'verifying', 'in_progress');

-- The verify route arrives with a token and nothing else, so the hash is the
-- only way back to the row. Partial: a fulfilled request has no live token.
CREATE INDEX IF NOT EXISTS "data_requests_token_idx"
  ON "data_requests" ("verify_token_hash")
  WHERE "verify_token_hash" IS NOT NULL;

-- The expiry sweep's own read: exports still sitting in Blob past their date.
CREATE INDEX IF NOT EXISTS "data_requests_export_expiry_idx"
  ON "data_requests" ("export_expires_at")
  WHERE "export_blob_key" IS NOT NULL;
