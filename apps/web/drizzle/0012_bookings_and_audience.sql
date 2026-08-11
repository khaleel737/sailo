-- Bookings & audience: busy-time sync, online events, contact tags, broadcasts.
--
-- Four features in one migration because they land as one release and every
-- one of them is additive: new nullable columns, new defaulted columns, new
-- tables. Nothing here rewrites a row that already exists, so a shop that
-- never opens any of these settings keeps behaving exactly as it did.

/* -------------------------------------------------------------------------- */
/*  1. Calendar busy-time sync                                                 */
/* -------------------------------------------------------------------------- */

-- The seller's calendar, read-only, as a URL rather than an OAuth grant.
--
-- Google, Apple and Outlook all publish a per-calendar "secret address in
-- iCal format", so one text column reaches every provider a seller might
-- actually use — where an OAuth integration reaches exactly one and only
-- after that provider has reviewed the app. It is a bearer secret: anyone
-- holding it can read the calendar, which is why it is never rendered back
-- to the browser in full and never leaves the server otherwise.
--
-- `checked_at` and `error` are the honesty of the feature. A feed that has
-- quietly stopped parsing looks identical to a calendar with nothing in it —
-- both hide no slots — and the difference is the seller's whole Tuesday.
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "calendar_feed_url" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "calendar_feed_checked_at" timestamp;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "calendar_feed_error" text;

/* -------------------------------------------------------------------------- */
/*  2. Online events                                                           */
/* -------------------------------------------------------------------------- */

-- Where an online event is joined. Held back until the order is released —
-- the same timestamp that opens a digital order's files and validates a
-- ticket — because a join link handed out at checkout is an event anyone
-- willing to click through checkout can attend without paying.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_join_url" text;

-- One row per reminder actually sent, and the unique index below is what
-- makes "actually" true.
--
-- The obvious shape — `reminded_24_at` on the order — is bug shape number
-- four in this codebase: an order is a header over lines, and a basket
-- holding two different events would stamp once and silently drop the second
-- event's reminder. Keyed by (order, product, lead) instead, so the unit of
-- "already reminded" is the same unit as "a thing that starts at a time".
--
-- The claim is the INSERT. `ON CONFLICT DO NOTHING RETURNING id` returns a
-- row to exactly one caller, so two overlapping cron passes — a retry, a
-- hand-run while debugging, two regions firing at once — send one email
-- between them rather than one each.
CREATE TABLE IF NOT EXISTS "event_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  /** '24h' | '1h' — which of the two passes this was. */
  "lead" text NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "event_reminders_key"
  ON "event_reminders" USING btree ("order_id", "product_id", "lead");

-- The reminder pass asks "which events start in the next hour", across every
-- shop on the platform, twice an hour forever. Without this it reads every
-- product row there is.
CREATE INDEX IF NOT EXISTS "products_event_starts_idx"
  ON "products" USING btree ("event_starts_at") WHERE "kind" = 'event';

/* -------------------------------------------------------------------------- */
/*  3. Contact tags and where a contact came from                              */
/* -------------------------------------------------------------------------- */

-- A real array rather than the jsonb `products.tags` uses, because these are
-- filtered on: `tags && '{vip}'` against a GIN index is an index scan, where
-- the same question asked of jsonb is a sequential read of every client the
-- shop has. Products are filtered in memory after a bounded read; clients
-- are the audience a broadcast is selected from, and that is a WHERE clause.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}' NOT NULL;

-- How this person got here: an order, a seller typing them in, a CSV.
-- Defaulted to 'order' because that is what every existing row is.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'order' NOT NULL;

CREATE INDEX IF NOT EXISTS "clients_tags_idx" ON "clients" USING gin ("tags");

/* -------------------------------------------------------------------------- */
/*  4. Broadcasts                                                              */
/* -------------------------------------------------------------------------- */

-- One marketing email a seller composes and sends to their consented
-- contacts.
--
-- `audience_tag` is a nullable text column and not the jsonb filter object
-- the spec sketched. v1 offers exactly two audiences — everyone consented, or
-- everyone consented carrying one tag — and a jsonb blob holding one optional
-- string is a general shape pretending to a generality the code does not
-- have. A second dimension can add a column, or replace this with the blob it
-- has by then earned.
CREATE TABLE IF NOT EXISTS "broadcasts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL,
  "subject" text NOT NULL,
  "body_markdown" text NOT NULL,
  /** draft | sending | sent */
  "status" text DEFAULT 'draft' NOT NULL,
  /** Null means every consented contact. */
  "audience_tag" text,
  /** How many rows were queued, so a partial send is visibly partial. */
  "recipient_count" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_shop_id_shops_id_fk"
  FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "broadcasts_shop_idx" ON "broadcasts" USING btree ("shop_id", "created_at");
-- The send pass looks for work: which broadcasts are mid-flight right now.
CREATE INDEX IF NOT EXISTS "broadcasts_status_idx" ON "broadcasts" USING btree ("status");

-- One row per address, written before anything is sent. The audit trail and,
-- more importantly, the resume point: a crash between batches leaves `queued`
-- rows, and the next tick picks them up rather than starting the broadcast
-- again.
--
-- `email` is snapshotted rather than read back through `client_id`, because
-- the address that was mailed is a fact and the client's current address is
-- not the same fact. `shop_id` is carried here too: the daily quota and the
-- suppression check are both shop-scoped questions, and a join to ask them is
-- a join that a mistake can forget.
CREATE TABLE IF NOT EXISTS "broadcast_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "broadcast_id" uuid NOT NULL,
  "shop_id" uuid NOT NULL,
  "client_id" uuid,
  "email" text NOT NULL,
  /** queued | sent | failed | suppressed */
  "status" text DEFAULT 'queued' NOT NULL,
  "provider_id" text,
  "error" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_broadcast_id_broadcasts_id_fk"
  FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_shop_id_shops_id_fk"
  FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_client_id_clients_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;

-- One address is mailed once per broadcast, enforced by Postgres rather than
-- by the loop that builds the queue. Two clients sharing an address, a
-- retried enqueue, a seller pressing Send twice — all of them collide here.
CREATE UNIQUE INDEX IF NOT EXISTS "broadcast_deliveries_target_key"
  ON "broadcast_deliveries" USING btree ("broadcast_id", "email");
-- The batch claim's own WHERE: this broadcast, still queued.
CREATE INDEX IF NOT EXISTS "broadcast_deliveries_queue_idx"
  ON "broadcast_deliveries" USING btree ("broadcast_id", "status");
-- "How much has this shop sent today", asked before every batch.
CREATE INDEX IF NOT EXISTS "broadcast_deliveries_shop_sent_idx"
  ON "broadcast_deliveries" USING btree ("shop_id", "sent_at");

-- Addresses this shop may never mail again, whatever any consent column says.
--
-- Separate from `clients.marketing_consent_at` on purpose. Consent is about a
-- person the seller knows; suppression is about an address, and the two come
-- apart exactly where it matters — an unsubscribe arrives from a mail client
-- with no session and no client id, a bounce arrives from Resend naming only
-- an address, and both must stick even if the person later places another
-- order that re-grants consent.
CREATE TABLE IF NOT EXISTS "email_suppressions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL,
  "email" text NOT NULL,
  /** unsubscribed | bounced | complained */
  "reason" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_shop_id_shops_id_fk"
  FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;

-- Unsubscribing twice is not an error, and the second click must not 500 in
-- front of someone who is already annoyed enough to be clicking it.
CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_shop_email_key"
  ON "email_suppressions" USING btree ("shop_id", "email");
