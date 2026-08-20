-- Indexes for the public API's list endpoints.
--
-- WHY THIS FILE EXISTS
--
-- `/api/v1` pages every list the same way: scope by `shop_id`, then a keyset
-- over `(created_at, id)` descending. That shape is only an index scan when a
-- single index carries `shop_id` first and `created_at, id` immediately after —
-- Postgres can turn a row-value comparison into an index qual only while the
-- row's columns line up with consecutive index columns. Anything sitting
-- between them makes the whole thing unusable, and the plan silently becomes
-- "read the shop's entire history, sort it, discard all but twenty-five".
--
-- Every index below was chosen against a measured plan on a container loaded to
-- realistic volume, not from reading the schema. The one that mattered is the
-- first.
--
-- Safe to re-run: every statement is IF NOT EXISTS.
--
-- Note for whoever applies this: CREATE INDEX takes a write lock for its
-- duration. On a large table run each of these by hand as CREATE INDEX
-- CONCURRENTLY, which cannot run inside a transaction block — the same
-- instruction 0033 carries, for the same reason. They are written plainly here
-- because that is what `drizzle-kit push` and a fresh environment can both run.

-- ---------------------------------------------------------------------------
-- booking_claims — the one that was actually broken
-- ---------------------------------------------------------------------------
--
-- `GET /api/v1/bookings` reaches a shop's appointments through `products`,
-- because `booking_claims` carries no `shop_id` of its own. That join needs an
-- index on `product_id`, and there was not one: the plain btree that used to
-- cover it was dropped in 0046, and what replaced it — `booking_claims_group_idx`
-- — is partial on `WHERE NOT is_exclusive`, which holds class seats and
-- deliberately excludes every ordinary one-to-one appointment. The GiST
-- exclusion constraint is on the expression `COALESCE(staff_id, product_id)`,
-- which a plain `product_id = $1` cannot use either.
--
-- The result, measured on 239,000 claims across 2,000 shops: a parallel
-- sequential scan of **every tenant's appointments** to return twenty-five
-- rows — 3,583 shared buffers, and growing with the platform rather than with
-- the shop. With this index the same query is a nested loop over that shop's
-- own products: 309 buffers, and it grows only with the seller's own diary.
--
-- `created_at, id` follow `product_id` so the keyset is served by the same
-- index rather than by a sort on top of it.
CREATE INDEX IF NOT EXISTS "booking_claims_product_keyset_idx"
  ON "booking_claims" ("product_id", "created_at", "id");

-- Declared in the Drizzle schema since spec 51 but created by no numbered
-- migration, so whether it exists depends on whether `db:push` has been run
-- against that environment — and this directory's README is explicit that there
-- is no record of what has. Stated here so it is true everywhere.
CREATE INDEX IF NOT EXISTS "booking_claims_staff_idx"
  ON "booking_claims" ("staff_id", "starts_at");

-- ---------------------------------------------------------------------------
-- The keyset indexes
-- ---------------------------------------------------------------------------
--
-- `clients` is the largest of these on any real shop and had nothing with
-- `created_at` in it at all, so a CRM mirror walking the list sorted the whole
-- address book once per page.
CREATE INDEX IF NOT EXISTS "clients_shop_keyset_idx"
  ON "clients" ("shop_id", "created_at", "id");

-- `products_shop_browse_idx` looks like it should serve this and cannot:
-- `is_featured` and `position` sit between `is_published` and `created_at`, so
-- the ordering is only reachable by a caller that pins all three — which this
-- endpoint never does, since two of them are not even filters on it.
CREATE INDEX IF NOT EXISTS "products_shop_keyset_idx"
  ON "products" ("shop_id", "created_at", "id");

-- `subscriptions_shop_idx` is `(shop_id, status, created_at)`, which serves a
-- filtered call and not the unfiltered one. "List my members" sends no status,
-- leaving the second column unconstrained and `created_at` unusable — so the
-- default call was the slow one, which is the wrong way round.
CREATE INDEX IF NOT EXISTS "subscriptions_shop_keyset_idx"
  ON "subscriptions" ("shop_id", "created_at", "id");

-- `scope` is second because the handler pins it to 'connected' on every call
-- and will never do otherwise: a platform dispute is Sailo's own argument with
-- a seller and never appears on this surface.
CREATE INDEX IF NOT EXISTS "disputes_shop_scope_keyset_idx"
  ON "disputes" ("shop_id", "scope", "created_at", "id");

-- A roster is bounded by real headcount, so this one buys little today. It is
-- here so that every list endpoint has the same plan shape, and nobody has to
-- remember which of them was the exception.
CREATE INDEX IF NOT EXISTS "staff_resources_shop_keyset_idx"
  ON "staff_resources" ("shop_id", "created_at", "id");

-- `contact_lists_shop_idx` is already `(shop_id, created_at)` and serves the
-- scan; this only adds `id` so the row-value comparison is an index qual rather
-- than a truncated `created_at <=` with a recheck and an incremental sort.
CREATE INDEX IF NOT EXISTS "contact_lists_shop_keyset_idx"
  ON "contact_lists" ("shop_id", "created_at", "id");

-- ---------------------------------------------------------------------------
-- automations — for the flows endpoints
-- ---------------------------------------------------------------------------
--
-- `automations_shop_idx` is `(shop_id, kind, status)`: three equalities and no
-- ordering column, so it scopes and then sorts. `kind` stays second because
-- every caller pins it — the admin builder and the API both address email
-- flows and scenarios separately, and they are different objects to a seller.
CREATE INDEX IF NOT EXISTS "automations_shop_keyset_idx"
  ON "automations" ("shop_id", "kind", "created_at", "id");

-- `automation_runs` has no `created_at` — the column that records when a
-- contact entered a flow is `entered_at`, and that is what the runs endpoint
-- orders by. `automation_runs_automation_idx (automation_id, status)` cannot
-- serve it.
CREATE INDEX IF NOT EXISTS "automation_runs_flow_keyset_idx"
  ON "automation_runs" ("automation_id", "entered_at", "id");
