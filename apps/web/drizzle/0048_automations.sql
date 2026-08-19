-- Spec 30 — flows. The gap `README.md` names three times.
--
-- Every table here is new and nothing existing changes, so an existing shop
-- reads and sells identically the moment this lands.
--
-- WHAT THIS IS NOT
--
-- It is not the twelve lifecycle rungs. `packages/marketing/src/lifecycle/`
-- is Sailo's own onboarding funnel *to sellers*: twelve rungs, anchored,
-- re-checked at send time, expiring, and decided in TypeScript because they
-- are a product decision Sailo makes and a seller cannot open a pull request
-- against. These tables are the same idea with the decisions moved into rows
-- because the author is the seller. `GAP-2026-08-easytools.md` §3.2 argues why
-- both exist; a migration that moved the rungs in here should be refused.
--
-- THE ONE SHARED TABLE
--
-- `automations.kind` is `'email' | 'scenario'`, and spec 31 reuses this table
-- rather than getting one of its own. A parallel execution path would be two
-- schedulers, two retry policies and two ways to send the same email twice.
--
-- THE IDENTITY OF A RUN IS AN ADDRESS
--
-- `automation_runs.email` is `not null` and `client_id` is `set null`. A run
-- must survive its contact: a buyer exercising deletion (spec 03) must not
-- strand a sequence half-sent or resurrect one. The address is what the run is
-- *about* and what every suppression check keys on; the ids are only how it
-- personalises.

-- ─── The automation, and what it sends ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS "automations" (
  "id"       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"  uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "name"     text NOT NULL,
  -- email | scenario — see the header. Spec 31 writes `scenario` here.
  "kind"     text NOT NULL DEFAULT 'email',
  -- draft | active | paused
  "status"   text NOT NULL DEFAULT 'draft',

  -- `{ type, config }` — see `TRIGGERS` in packages/marketing/src/automations.
  "trigger"  jsonb,
  -- `{ nodes: [...], edges: [...] }`, validated on save *and again at claim
  -- time*: a graph edited while runs are in flight is normal, and a cursor
  -- pointing at a deleted node must fail that run rather than crash the tick.
  "graph"    jsonb,

  -- once | repeat. `once` means a contact never re-enters. `repeat` means they
  -- may, but never while a run is live, and never twice inside
  -- `REPEAT_FLOOR_MS` — without a floor a `contact.updated` trigger on a field
  -- the flow itself writes mails somebody hourly for ever.
  "entry_policy" text NOT NULL DEFAULT 'once',

  "activated_at" timestamp,
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "updated_at"   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "automations_shop_idx"
  ON "automations" ("shop_id", "kind", "status");

-- The tick's own lookup: every active automation across the fleet, so one scan
-- finds work rather than one per shop.
CREATE INDEX IF NOT EXISTS "automations_active_idx"
  ON "automations" ("status")
  WHERE "status" = 'active';

CREATE TABLE IF NOT EXISTS "automation_emails" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "automation_id" uuid NOT NULL REFERENCES "automations"("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  "subject"       text NOT NULL,
  "preheader"     text,
  "body_md"       text NOT NULL DEFAULT '',
  -- Reserved, and deliberately unused in v1: §4 refuses per-seller sending
  -- domains, so every message still leaves from the shared one. The columns
  -- exist so the day that refusal is revisited is a migration nobody needs.
  "from_address"  text,
  "reply_to"      text,
  "position"      integer NOT NULL DEFAULT 0,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  "updated_at"    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "automation_emails_automation_idx"
  ON "automation_emails" ("automation_id", "position");

-- ─── One contact walking one flow ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "automation_runs" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "automation_id" uuid NOT NULL REFERENCES "automations"("id") ON DELETE CASCADE,
  "shop_id"       uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "client_id"     uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  -- The durable identity. See the header.
  "email"         text NOT NULL,

  -- queued | waiting | done | failed | cancelled
  "status"        text NOT NULL DEFAULT 'queued',
  -- Which node this run is standing on. Null once finished.
  "cursor"        text,
  -- When the tick may pick it up. Never null while queued or waiting — a run
  -- with no wake time is a run nothing will ever look at again.
  "wake_at"       timestamp,
  "attempt"       integer NOT NULL DEFAULT 0,

  "entered_at"    timestamp NOT NULL DEFAULT now(),
  "finished_at"   timestamp,
  "last_error"    text
);

-- The tick's claim: what is due, across the fleet, oldest first.
CREATE INDEX IF NOT EXISTS "automation_runs_due_idx"
  ON "automation_runs" ("status", "wake_at")
  WHERE "status" IN ('queued', 'waiting');

CREATE INDEX IF NOT EXISTS "automation_runs_automation_idx"
  ON "automation_runs" ("automation_id", "status");

-- The suppression check and the metrics screen both ask by address.
CREATE INDEX IF NOT EXISTS "automation_runs_email_idx"
  ON "automation_runs" ("shop_id", "email");

-- `entry_policy = 'once'`, as a constraint rather than as a read-then-write.
--
-- Partial on the live states, which is what makes it serve both policies with
-- one index: under `repeat` a contact may re-enter, but never while a run is
-- live, and this is that rule. `once` adds its own check in `enrol` against
-- the finished rows as well — the index cannot express "and never again"
-- without also forbidding the re-entry `repeat` exists to allow.
CREATE UNIQUE INDEX IF NOT EXISTS "automation_runs_live_key"
  ON "automation_runs" ("automation_id", "email")
  WHERE "status" IN ('queued', 'waiting');

-- ─── The timeline ───────────────────────────────────────────────────────────

-- One row per node entered, which is what makes "why did this contact stop"
-- answerable at all.
CREATE TABLE IF NOT EXISTS "automation_steps" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id"      uuid NOT NULL REFERENCES "automation_runs"("id") ON DELETE CASCADE,
  "node_id"     text NOT NULL,
  "kind"        text NOT NULL,
  "entered_at"  timestamp NOT NULL DEFAULT now(),
  "left_at"     timestamp,
  -- sent | waited | branched | filtered | skipped | deferred | failed | handed_off
  "outcome"     text,
  "detail"      text,
  -- `set null`, never cascade: `broadcast_deliveries` rows are reputation
  -- evidence and they outlive the flow that produced them. Deleting an
  -- automation must not delete the record of what it sent.
  "delivery_id" uuid REFERENCES "broadcast_deliveries"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "automation_steps_run_idx"
  ON "automation_steps" ("run_id", "entered_at");

-- ─── Unsubscribing from one flow ────────────────────────────────────────────

-- Theirs, and worth copying exactly: an unsubscribe from an automation email
-- stops *that automation* for ever, even on re-entry, and does **not** remove
-- the contact from any list. A global suppression still outranks it.
--
-- Its own table rather than a list mutation, because those are different
-- facts: leaving a list is a grouping changing, and this is a person saying
-- "not this sequence". Conflating them would have an unsubscribe silently
-- shrink an audience the seller curated by hand.
CREATE TABLE IF NOT EXISTS "automation_opt_outs" (
  "automation_id" uuid NOT NULL REFERENCES "automations"("id") ON DELETE CASCADE,
  "email"         text NOT NULL,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("automation_id", "email")
);

-- ─── One delivery ledger, not two ───────────────────────────────────────────

-- An automation send writes a `broadcast_deliveries` row like every other
-- marketing message this platform sends, so opens, bounces and complaints land
-- where the Resend webhook already looks and so the daily ceilings already
-- count it. That is the spec's instruction and it is the right one: a second
-- ledger would be a second place the suppression webhook has to know about,
-- and the first one somebody forgets.
--
-- The column has to become nullable for that, because an automation send
-- belongs to no broadcast. Nothing reads it except code already scoped to one
-- broadcast: `finish`, `progress` and the send batch all filter by a specific
-- `broadcast_id`, so a null row is invisible to them; the Resend webhook keys
-- on `provider_id` and reads only `shop_id` and `email`; and the quota and
-- reputation queries group by shop, which is exactly where an automation send
-- should count.
--
-- `broadcast_deliveries_target_key` is unaffected in the way that matters:
-- Postgres treats NULLs as distinct, so it goes on deduplicating a broadcast's
-- own rows while allowing a flow to send the same contact several messages —
-- which is what a sequence *is*.
--
-- The link back is `automation_steps.delivery_id`. Deliberately not a new
-- column on the ledger: that table answers deliverability questions for the
-- whole platform, and growing it a nullable foreign key for one feature's
-- convenience is how it ends up with a column only one reader understands.
ALTER TABLE "broadcast_deliveries"
  ALTER COLUMN "broadcast_id" DROP NOT NULL;
