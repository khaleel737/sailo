-- Integrations: outbound webhooks, and the keys that let a program pull.
--
-- Three tables, one migration, because they are one feature. A webhook tells
-- an outside tool that something happened; an API key lets that tool ask a
-- follow-up question. Either alone is half an integration — a Zap that fires
-- and cannot look anything up, or a key with nothing to trigger it.
--
-- This is `docs/specs/16-outbound-webhooks.md` plus the API half the spec
-- assumed would follow it. What it replaces is the idea of building a named
-- integration per logo: Zapier, n8n and Make all consume a plain signed POST,
-- and every tool behind them comes free with the first one.
--
-- Nothing here touches an existing table. That is deliberate and it is what
-- makes this migration safe to apply ahead of the code: until something writes
-- a row, all three are inert.

/* -------------------------------------------------------------------------- */
/*  Where a shop's events go                                                   */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,

  "url" text NOT NULL,
  "label" text,

  -- Plaintext, because HMAC needs the key on both sides. What it grants is the
  -- ability to forge a message *to the seller's endpoint* — it reads nothing
  -- here and moves no money. See the note in src/db/schema/integrations.ts.
  "secret" text NOT NULL,

  "events" text[] DEFAULT '{}' NOT NULL,

  "is_active" boolean DEFAULT true NOT NULL,
  "disabled_reason" text,

  -- Consecutive, reset by any success. Total failures would condemn an
  -- endpoint that had a bad week last March and works perfectly today.
  "failure_count" integer DEFAULT 0 NOT NULL,

  "last_attempt_at" timestamp,
  "last_status" text,
  "last_response_status" integer,

  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,

  CONSTRAINT "webhook_endpoints_failure_count_positive" CHECK ("failure_count" >= 0)
);

CREATE INDEX IF NOT EXISTS "webhook_endpoints_shop_idx"
  ON "webhook_endpoints" ("shop_id");

-- "Press Add twice" is the ordinary double-submit, and two endpoints on one
-- URL means every order arrives in that Zap twice. A constraint rather than a
-- read-then-write, because two submissions in flight together both pass a read.
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_endpoints_shop_url_key"
  ON "webhook_endpoints" ("shop_id", "url");

-- The emit path's question: which of this shop's endpoints are still live.
CREATE INDEX IF NOT EXISTS "webhook_endpoints_active_idx"
  ON "webhook_endpoints" ("shop_id", "is_active");

/* -------------------------------------------------------------------------- */
/*  Every attempt to deliver one                                               */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "endpoint_id" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE,

  -- Denormalised so the pruning sweep and the seller's log are index scans
  -- rather than joins. It cannot drift: an endpoint never changes shop.
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,

  "event" text NOT NULL,

  -- The body as it was when the event happened, not as the row reads now. A
  -- retry twelve hours later must not describe an `order.created` for an order
  -- that has since been refunded.
  "payload" jsonb NOT NULL,

  -- pending | ok | failed. No in-flight state: the drain claims a row by
  -- leasing it forward on next_attempt_at, so a tick that dies mid-POST leaves
  -- a row that simply becomes due again rather than one stranded for ever.
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,

  "next_attempt_at" timestamp DEFAULT now() NOT NULL,

  "response_status" integer,
  "error" text,

  "delivered_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,

  CONSTRAINT "webhook_deliveries_attempt_positive" CHECK ("attempt" >= 0)
);

-- The drain's whole query: pending, due, oldest first. Without it every tick
-- sequential-scans the one table in the schema built to accumulate rows.
CREATE INDEX IF NOT EXISTS "webhook_deliveries_due_idx"
  ON "webhook_deliveries" ("status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "webhook_deliveries_endpoint_idx"
  ON "webhook_deliveries" ("endpoint_id", "created_at");

-- The seller's log and the thirty-day prune, from one index.
CREATE INDEX IF NOT EXISTS "webhook_deliveries_shop_idx"
  ON "webhook_deliveries" ("shop_id", "created_at");

/* -------------------------------------------------------------------------- */
/*  Keys that let a program pull                                               */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,

  "label" text NOT NULL,

  -- The non-secret head of the token, so a seller with three keys knows which
  -- one to revoke and a refused request can be named in support.
  "prefix" text NOT NULL,

  -- SHA-256 of the whole token. A slow KDF would buy nothing against 32 bytes
  -- of randomness and would cost a hash on the hot path of every request.
  "token_hash" text NOT NULL,

  "scopes" text[] DEFAULT ARRAY['read']::text[] NOT NULL,

  "last_used_at" timestamp,

  -- Revocation is a stamp, not a delete: "what was that key called and when
  -- did we turn it off" is the first question asked after a leak.
  "revoked_at" timestamp,

  "created_at" timestamp DEFAULT now() NOT NULL
);

-- The lookup, on every authenticated API and MCP request. Unique because two
-- rows carrying one hash would mean two shops behind one token.
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_token_hash_key"
  ON "api_keys" ("token_hash");

CREATE INDEX IF NOT EXISTS "api_keys_shop_idx"
  ON "api_keys" ("shop_id");
