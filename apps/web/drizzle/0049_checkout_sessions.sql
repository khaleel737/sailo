-- Spec 32 — a row for every checkout opened, and one email to the buyer who
-- walked away.
--
-- One new table, three nullable columns on `shops` and one on `products`, so
-- an existing shop reads and sells identically the moment this lands and
-- recovers nothing until a seller switches it on.
--
-- WHAT IS TAKEN, AND WHAT IS REFUSED
--
-- Their feature is a staffed service on a 10% commission: consultants phone
-- the buyer, they run remarketing at their own expense, and — decisively —
-- *"we also have data of people from our entire network in your cart."*
--
-- All three are refused here, and the reasons are structural rather than
-- squeamish. The seller is merchant of record and Sailo never touches the
-- money, so there is no settlement to take a commission at. There is no
-- cross-seller buyer network, and building one would put one seller's buyers
-- inside another seller's checkout — `GAP-2026-08-easytools.md` §4.2 calls
-- that a boundary, not a roadmap item. There is no `commission` column in this
-- file and no query in this feature joins sessions across shops.
--
-- What is taken is the machinery, which is excellent and unencumbered: the
-- session row, the status vocabulary, the three-hour threshold, and the
-- randomised discount — whose reasoning is worth preserving because it is the
-- clever part: **award a recovery discount every time and buyers learn to
-- abandon on purpose.**
--
-- THE HALF NOBODY ELSE CAN BUILD
--
-- The abandoned Stripe session is the primary case and the one the spec is
-- written for. But `README.md` records that on the chat rails *"the order is
-- persisted first, then the buyer is handed off. The seller keeps the lead
-- even if the handoff never completes."* That already-persisted order — basket,
-- contact, everything — is sitting unread, and nobody is recovering it.
--
-- It costs almost nothing once the card half exists, because the follow-up
-- machinery is the same, and no competitor can build it, because no competitor
-- persists an order before the money. `handoff_order_id` below is what lets one
-- table carry both: a session with no Stripe checkout behind it, pointing at
-- the order that was already written.

-- ─── The session ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "checkout_sessions" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"    uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "order_id"   uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "client_id"  uuid REFERENCES "clients"("id") ON DELETE SET NULL,

  -- What the buyer typed into *this* checkout. The consent rule turns on it:
  -- a recovery mail may go to an address typed here, or to an existing client
  -- of this shop, and to nothing else ever.
  "email" text,
  "phone" text,

  -- opened | error | recovering | recovered | finalized | help_requested | expired
  "status" text NOT NULL DEFAULT 'opened',

  /*
   * Which browser this is, as an opaque first-party id.
   *
   * Not derived from IP or user agent: a phone changing network mid-checkout
   * would read as two buyers, which is the reasoning the download rate limit
   * already records. Not a cross-shop identifier either — the unique index
   * below is keyed per shop and no query in this feature joins across shops.
   */
  "visitor_key" text NOT NULL,

  "currency"       text,
  "subtotal_cents" integer,

  -- Stripe's decline message, through an allowlist before it is stored, and
  -- shown to the seller only. Never a card detail, never a client secret,
  -- never a PAN — this column records that an attempt failed and why, and
  -- nothing whatsoever about the instrument.
  "last_error" text,

  -- A real single-use coupon, minted per session and expiring with it. Null
  -- when the coin came up tails, which is most of the time and is the point.
  "discount_code" text,

  /*
   * The chat-rail half. An order that was persisted and then handed off to
   * WhatsApp, where the buyer never sent the message.
   *
   * Separate from `order_id`, which is the order this session *became*. This
   * one is the order it started from, and the two are different questions: a
   * recovered handoff has both, pointing at the same row.
   */
  "handoff_order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL,

  "recovery_sent_at" timestamp,
  "recovered_at"     timestamp,

  "opened_at"    timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  -- Thirty days, theirs: "we remember their entry for 30 days".
  "expires_at"   timestamp
);

/*
 * One live session per (shop, browser, product).
 *
 * Partial on the states that are still open, which is what makes a revisit
 * update rather than insert while still letting the same buyer come back next
 * month and start a new one. Their behaviour exactly: *"if a customer revisits
 * the same checkout from the same device and browser, a new session is not
 * created."*
 *
 * `product_id` is nullable and Postgres treats NULLs as distinct, so a cart
 * checkout — which names no single product — gets one row per view rather than
 * one row. `checkout_sessions_visitor_cart_key` below is that case.
 */
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_sessions_visitor_key"
  ON "checkout_sessions" ("shop_id", "visitor_key", "product_id")
  WHERE "status" IN ('opened', 'error', 'help_requested')
    AND "product_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_sessions_visitor_cart_key"
  ON "checkout_sessions" ("shop_id", "visitor_key")
  WHERE "status" IN ('opened', 'error', 'help_requested')
    AND "product_id" IS NULL;

-- The seller's table, filtered by status.
CREATE INDEX IF NOT EXISTS "checkout_sessions_shop_idx"
  ON "checkout_sessions" ("shop_id", "status", "opened_at");

-- The recovery pass's own lookup: what is abandoned, across the fleet. Partial
-- on the two recoverable states so the scan stays small as history grows.
CREATE INDEX IF NOT EXISTS "checkout_sessions_due_idx"
  ON "checkout_sessions" ("status", "opened_at")
  WHERE "status" IN ('opened', 'error');

-- The resume link's lookup, and the expiry sweep's.
CREATE INDEX IF NOT EXISTS "checkout_sessions_expiry_idx"
  ON "checkout_sessions" ("expires_at")
  WHERE "expires_at" IS NOT NULL;

-- ─── The settings ───────────────────────────────────────────────────────────

ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "recovery_enabled" boolean NOT NULL DEFAULT false,
  -- Flat *or* percentage, theirs supports both, and exactly one may be set.
  -- Both null means the recovery mail carries no discount at all, which is a
  -- perfectly good configuration and the safest default.
  ADD COLUMN IF NOT EXISTS "recovery_discount_bp" integer,
  ADD COLUMN IF NOT EXISTS "recovery_discount_cents" integer,
  /*
   * How often the discount is actually awarded, in basis points.
   *
   * The clever part of their design, and the comment is the reason it exists:
   * award one every time and buyers learn to abandon on purpose. Default 5000
   * — a coin flip.
   */
  ADD COLUMN IF NOT EXISTS "recovery_discount_odds_bp" integer NOT NULL DEFAULT 5000;

/*
 * Nullable, and the null is the point: it means **inherit the shop**.
 *
 * Blank is not false. `false` here is a seller switching recovery off for one
 * product with the shop's setting left on, and `null` is a product that has
 * never been asked — which is every product that existed before this migration.
 * Collapsing the two would turn "I haven't decided" into "no", silently, for
 * an entire catalogue.
 */
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "recovery_enabled" boolean;
