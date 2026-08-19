-- Spec 50 — event depth: tiers, sessions, attendee details, transfer, venue,
-- timezone, event policy.
--
-- Events were three columns — `event_starts_at`, `event_ends_at`,
-- `event_join_url` — on top of a genuinely good ticketing engine. Everything
-- an event *seller* configures was missing.
--
-- Sailo is ahead of Easytools on events and it is not close, so the benchmark
-- for this migration is event ticketing platforms: tiered tickets with their
-- own price, capacity and sale window; ticket transfer; per-attendee details;
-- calendar attachments; and session selection. Sailo had the engine for all of
-- it and the configuration for none.
--
-- Every column is nullable or carries the default that reproduces today's
-- behaviour exactly, and both new tables start empty: an event that exists a
-- minute before this runs sells identically a minute after. The `0034`
-- discipline.
--
-- ─── THE RISKIEST LINE IN THIS FILE ─────────────────────────────────────────
--
-- **Capacity is two-level and both levels must hold.** A room of 200 with 30
-- VIP seats is a product stock of 200 and a tier capacity of 30. A claim must
-- succeed against *both* or fail, in one transaction, and **the narrower one
-- goes first** — the tier, then the product.
--
-- Getting the order wrong oversells the tier while the product still looks
-- available, which is the one failure an event seller cannot forgive: thirty-
-- one people arrive holding a VIP ticket for thirty seats.
--
-- `sold` on `event_tiers` and `event_sessions` is a counter claimed by
-- conditional UPDATE with the ceiling in the WHERE — `set sold = sold + n where
-- capacity is null or sold + n <= capacity` — never a read followed by a write.
-- `PRODUCTION-PLAN.md`'s concurrent-double-booking defect was exactly this
-- class and was only found by a scenario test.
--
-- ─── 1. TICKET TIERS ────────────────────────────────────────────────────────
--
-- `tickets.tier` already existed as a column and nothing wrote a meaningful
-- value, because there was no tier to name: a product had one price and one
-- stock count, so "Early bird / General / VIP" meant three products, three
-- checkouts and no shared capacity.
--
-- **Why a table and not variants.** Variants exist and carry price, stock and
-- SKU — but a variant is an *option combination* (size × colour) driven by
-- `products.options`, and forcing a tier into that shape makes an event's tiers
-- a fake option group that renders in the option picker and appears in every
-- variant matrix. Tiers are their own list with their own sale windows.
--
--   capacity      NULL shares the product's stock, which is what a single-tier
--                 event does today.
--   sell_from /
--   sell_until    Spec 43's window mechanism reused verbatim, per tier. Early
--                 bird expiring while General keeps selling is the case, and
--                 it is why 43 put windows on variants too.
--   is_hidden     A comp or press tier reachable only by direct link.
--
-- ─── 2. SESSIONS ────────────────────────────────────────────────────────────
--
-- A weekly class, a three-day conference with day tickets, a workshop run four
-- times — each was a separate product, so the seller re-typed everything and
-- the attendee list was split in four.
--
--   products.session_mode   NULL reproduces today exactly. 'pick_one' is the
--                           buyer choosing a session (Tuesday *or* Thursday);
--                           'all_access' is one ticket admitting every session
--                           (a conference pass).
--   order_items.session_id  Which one this line bought.
--
-- **Capacity is per session under `pick_one` and per product under
-- `all_access`**, with the same two-level discipline as tiers: a `pick_one`
-- purchase claims the *session's* capacity, not the product's.
--
-- **No recurrence rule engine.** No RRULE, no infinite series. A "generate
-- weekly for 8 weeks" button that writes 8 rows the seller can then edit
-- individually is the whole feature, and it never has to answer "what does
-- editing the series do to the one you have already sold tickets for".
--
-- `event_reminders` keys on the session where one exists — its unique index is
-- (order, product, lead) and gains the session, or a conference pass reminds
-- once for eight days.
--
-- ─── 3. ATTENDEE DETAILS ────────────────────────────────────────────────────
--
-- `tickets.attendee_name` and `attendee_email` existed and nothing collected
-- them, so a buyer taking four tickets created four rows with their own details
-- and the door list was one name four times.
--
--   products.collect_attendee_details
--
-- **An attendee email is not a marketing contact.** Consent is a thing a person
-- gave, and the purchaser cannot give it for their guest — `clients` is never
-- written from an attendee row.
--
-- ─── 4. TRANSFER ────────────────────────────────────────────────────────────
--
--   tickets.transferred_from_ticket_id / transferred_at
--
-- **Transfer voids the old code and mints a new one.** Not a name change: the
-- old screenshot has to stop working, or two people arrive with one admission
-- and the scanner is right to show amber for both. Refused once `used_at` is
-- set — a used ticket is spent.
--
-- The new code is minted by `newTicketCode`, so it stays ten characters after
-- folding and `admit_any_code`'s ticket-versus-pass arithmetic is untouched.
--
-- ─── 5. VENUE, TIMEZONE, AND THE ONLINE/IN-PERSON SPLIT ─────────────────────
--
--   products.event_mode        online | in_person | hybrid
--   products.event_venue_name / event_address
--   products.event_time_zone   Falls back to `shops.time_zone`.
--
-- **A time zone per event, not per shop.** A seller in Dubai running a webinar
-- for a London audience is the normal case, and `shops.time_zone` — which
-- exists to make opening hours mean anything — is the wrong answer for it.
--
-- ─── 6. EVENT POLICY ────────────────────────────────────────────────────────
--
-- An event sells a moment, so its policy differs from a physical good's, and
-- `refund_policy_disclosure` is a real Stripe evidence field.
--
--   event_refund_policy / event_refund_cutoff_hours / event_allow_self_cancel
--
-- Snapshotted to `policy_snapshots` at purchase, so a dispute months later
-- cites what the buyer saw. Self-cancel inside the cutoff releases capacity
-- back — the same conditional-UPDATE restock path the sweep already uses — and
-- notifies spec 33's waitlist, because a released seat nobody is told about is
-- a lost sale.
--
-- Safe to re-run: IF NOT EXISTS throughout.

-- ─── products ───────────────────────────────────────────────────────────────

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "session_mode" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "collect_attendee_details" boolean DEFAULT false NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_mode" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_venue_name" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_address" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_time_zone" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_refund_policy" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_refund_cutoff_hours" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_allow_self_cancel" boolean DEFAULT false NOT NULL;

-- ─── event_tiers ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "event_tiers" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id"    uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  "description"   text,
  "price_cents"   integer NOT NULL DEFAULT 0,
  -- NULL shares the product's stock, which is a single-tier event today.
  "capacity"      integer,
  -- The counter the claim moves. Never read-then-written.
  "sold"          integer NOT NULL DEFAULT 0,
  "sell_from"     timestamp,
  "sell_until"    timestamp,
  "max_per_order" integer,
  "position"      integer NOT NULL DEFAULT 0,
  "is_hidden"     boolean NOT NULL DEFAULT false,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  "updated_at"    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "event_tiers_product_idx"
  ON "event_tiers" ("product_id", "position");

-- Never oversold, in the database as well as in the claim.
--
-- The conditional UPDATE is what actually decides — the ceiling is in its
-- WHERE — and this is the floor under it: a seller editing a tier's capacity
-- down below what has already sold, or an import writing a bad number, would
-- otherwise leave a row that says thirty-one of thirty seats are gone and no
-- statement anywhere would refuse it.
DO $$ BEGIN
  ALTER TABLE "event_tiers"
    ADD CONSTRAINT "event_tiers_not_oversold"
    CHECK ("capacity" IS NULL OR "sold" <= "capacity");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── event_sessions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "event_sessions" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id"   uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "starts_at"    timestamp NOT NULL,
  "ends_at"      timestamp,
  "capacity"     integer,
  "sold"         integer NOT NULL DEFAULT 0,
  "location"     text,
  "join_url"     text,
  "is_cancelled" boolean NOT NULL DEFAULT false,
  -- The claim on "tell the ticket-holders this session is off", not a log of
  -- it. A cancelled session's mail is a bulk send against the broadcast quota,
  -- exactly as spec 33's waitlist notify is, and two cron ticks must send it
  -- once between them.
  "cancel_notified_at" timestamp,
  "position"     integer NOT NULL DEFAULT 0,
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "updated_at"   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "event_sessions_product_idx"
  ON "event_sessions" ("product_id", "starts_at");

DO $$ BEGIN
  ALTER TABLE "event_sessions"
    ADD CONSTRAINT "event_sessions_not_oversold"
    CHECK ("capacity" IS NULL OR "sold" <= "capacity");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── order_items ────────────────────────────────────────────────────────────

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "session_id" uuid;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "tier_id" uuid;

DO $$ BEGIN
  ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_session_fk"
    FOREIGN KEY ("session_id") REFERENCES "event_sessions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_tier_fk"
    FOREIGN KEY ("tier_id") REFERENCES "event_tiers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The restock sweep's own question: which lines hold a session's seats.
CREATE INDEX IF NOT EXISTS "order_items_session_idx"
  ON "order_items" ("session_id")
  WHERE "session_id" IS NOT NULL;

-- ─── tickets ────────────────────────────────────────────────────────────────

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "session_id" uuid;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "tier_id" uuid;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "transferred_from_ticket_id" uuid;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "transferred_at" timestamp;

DO $$ BEGIN
  ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_session_fk"
    FOREIGN KEY ("session_id") REFERENCES "event_sessions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_tier_fk"
    FOREIGN KEY ("tier_id") REFERENCES "event_tiers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Self-referencing: the chain a seller reads when a ticket has moved three
-- times, which is a resale pattern worth being able to see.
DO $$ BEGIN
  ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_transferred_from_fk"
    FOREIGN KEY ("transferred_from_ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── event_reminders ────────────────────────────────────────────────────────
--
-- The claim gains the session, or a conference pass reminds once for eight days
-- instead of once per session. **The existing unique index is replaced rather
-- than added to**, because two indexes would both be satisfiable and the
-- claim's `ON CONFLICT` can only infer one of them.
--
-- `NULLS NOT DISTINCT` because `session_id` is null for every event that has no
-- sessions — which is all of them today. Under the default rule the constraint
-- would not fire for exactly those rows, and a single-session event would be
-- reminded once per cron tick, for ever.

ALTER TABLE "event_reminders" ADD COLUMN IF NOT EXISTS "session_id" uuid;

DO $$ BEGIN
  ALTER TABLE "event_reminders"
    ADD CONSTRAINT "event_reminders_session_fk"
    FOREIGN KEY ("session_id") REFERENCES "event_sessions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS "event_reminders_key";

CREATE UNIQUE INDEX IF NOT EXISTS "event_reminders_key"
  ON "event_reminders" ("order_id", "product_id", "session_id", "lead")
  NULLS NOT DISTINCT;
