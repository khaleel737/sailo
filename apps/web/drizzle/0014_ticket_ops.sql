-- Working a door, rather than validating one code at a time.
--
-- 0006 gave an admission a row and a code, and the claim in `check_in` is
-- still the only thing that decides whether somebody gets in. What it never
-- gave anyone was the event around it: who is on the list, how many are in,
-- who admitted them, and how a guest who never bought a ticket — a comp, a
-- VIP, a sponsor's allocation, somebody who paid the organiser in cash — gets
-- through the door at all.
--
-- Two changes carry that. Tickets learn who they are *for*, separately from
-- who paid; and a ticket no longer has to have an order behind it.

/* -------------------------------------------------------------------------- */
/*  Who the admission is for                                                   */
/* -------------------------------------------------------------------------- */

-- Null falls back to the order's `customer_name` at read time, which is what
-- every ticket sold through checkout will do — nothing collects a per-head
-- name at checkout yet. An imported or walk-up guest has their own.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "attendee_name" text;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "attendee_email" text;

-- The tier as it read when the ticket was minted. A snapshot rather than a
-- join: variants get renamed between the on-sale and the night, and get
-- deleted outright, and neither may change what is printed beside a name on
-- the door list of an event that has already happened.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "tier" text;

-- order | import | manual. A comp is not a sale, and every count that mixes
-- the two — attendance against revenue, most obviously — is wrong the moment
-- a seller papers a room.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'order' NOT NULL;

-- Which door pass admitted them; null means the shop owner's own session.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "checked_in_by" text;

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "note" text;

/* -------------------------------------------------------------------------- */
/*  A ticket without an order                                                  */
/* -------------------------------------------------------------------------- */

/*
 * The alternative was minting a zero-value order per imported guest so the FK
 * could stay NOT NULL, and it is worse than it looks: two hundred comps would
 * be two hundred rows in the seller's orders list, in every export, in the
 * order count on the dashboard, and in the average-order-value figure. The
 * accounting has to stay honest about what was sold, so the ticket loses the
 * requirement instead.
 *
 * This moves a rule. Validity used to read "the order is released"; it now
 * reads "the order is released, or the seller issued this directly". The
 * second half is not a loophole — issuing a ticket already requires the
 * seller's own session, which is a stronger claim than a settled payment.
 *
 * `check_in_ticket_for_shop` has to test the null explicitly: EXISTS over a
 * null `order_id` is false, so a comp would otherwise be refused at the door
 * with "this order isn't paid yet" and no order to point at.
 */
ALTER TABLE "tickets" ALTER COLUMN "order_id" DROP NOT NULL;

/* -------------------------------------------------------------------------- */
/*  Indexes the door list reads through                                        */
/* -------------------------------------------------------------------------- */

-- Every counter and every door-list page is "this shop, this event, this
-- status". At five hundred admissions on a phone over venue wifi, the
-- difference between this and `tickets_shop_idx` is the difference between a
-- list that opens and one that times out.
CREATE INDEX IF NOT EXISTS "tickets_shop_product_status_idx"
  ON "tickets" USING btree ("shop_id", "product_id", "status");

-- Looking a guest up by the address they booked with, which is what somebody
-- who has lost their email will offer at the door.
CREATE INDEX IF NOT EXISTS "tickets_attendee_email_idx"
  ON "tickets" USING btree ("shop_id", "attendee_email");

/* -------------------------------------------------------------------------- */
/*  Door passes                                                                */
/* -------------------------------------------------------------------------- */

/*
 * Whoever is on the door is usually not whoever owns the shop. Until now the
 * only way to let a volunteer scan was to hand them the seller's login, which
 * is also the payouts, the customer list and the bank details — so the honest
 * description of the previous state is that check-in had no delegation story
 * at all.
 *
 * A pass is an unguessable token on a row, the same shape the affiliate
 * portal uses (`lib/affiliate-portal.ts`): no account to create for somebody
 * who is helping out for one evening, and revocation is a single UPDATE that
 * takes effect on the next request rather than whenever a session expires.
 *
 * It is named because `tickets.checked_in_by` needs something to record. A
 * door with three volunteers and one shared credential cannot answer "who let
 * this person in", and that question only ever gets asked after something has
 * gone wrong.
 */
CREATE TABLE IF NOT EXISTS "door_passes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  -- Null means every event in the shop, for a venue running four rooms on one
  -- night. The UI offers the event you are standing in first.
  "product_id" uuid REFERENCES "products"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "token" text NOT NULL,
  -- A pass that outlives the event is a credential nobody remembers issuing.
  "expires_at" timestamp,
  "revoked_at" timestamp,
  "last_used_at" timestamp,
  "check_in_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "door_passes_token_key"
  ON "door_passes" USING btree ("token");
CREATE INDEX IF NOT EXISTS "door_passes_shop_idx"
  ON "door_passes" USING btree ("shop_id");
