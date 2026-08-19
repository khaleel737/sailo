-- Spec 34 — one audience, addressable by list, described by fields the seller
-- invents.
--
-- Every table here is new and the one added column is nullable, so an existing
-- shop reads and sells identically the moment this lands.
--
-- THE CONTACT IS `clients`, AND THERE IS NO NEW CONTACT TABLE
--
-- The spec opens on "two half-audiences" — `clients`, and a shop's newsletter
-- `subscribers` — and keys everything below on the email address so a row
-- survives either source being deleted. Both halves of that premise are wrong
-- about this tree, and building to them would have been a bug rather than a
-- schema:
--
--   1. There is no shop-scoped subscribers table. `/[handle]/subscribe` writes
--      `clients` with `source = 'subscribe'` — read `confirmSubscriber` in
--      `packages/marketing/src/broadcasts/subscribe.ts`, which upserts that
--      row. The `newsletter_subscribers` table is **Sailo's own** mailing
--      list, platform-wide and with no `shop_id` at all; its header says so in
--      as many words. A `subscriber_id` on a shop's list member would have
--      pointed a seller's audience at the platform's readers.
--
--   2. `clients` already *is* the amended identity. The wave brief replaces
--      "unique by email" with "(shop, email OR phone), either sufficient", so a
--      WhatsApp buyer with no address is a first-class contact — and
--      `clients_shop_email_key` and `clients_shop_phone_key` are that rule,
--      already enforced by Postgres since 0012.
--
-- So membership and field values hang off `client_id`, not off an address.
-- That is what carries the amendment: an address-keyed member row cannot hold
-- a contact who has no address, which is precisely the buyer the amendment
-- exists for. The spec's reason for keying on the address — surviving the
-- deletion of one of two source rows — was an artefact of the two-source
-- premise, and with one source it costs the phone-only contact for nothing.
--
-- What is kept from that reasoning is the snapshot: `email` rides on the
-- member row as it read when they joined, the same way `broadcast_deliveries`
-- snapshots the address it mailed. Who was on the list in March is a fact, and
-- it must not be rewritten by a buyer changing their address in June.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No suppression table: `email_suppressions` already exists, is already keyed
-- on (shop, address), and rule 8 — that only a fresh confirmed opt-in lifts an
-- `unsubscribed` row and nothing lifts `bounced` or `complained` — is already
-- built in `confirmSubscriber`. This spec must not weaken it, so it does not
-- get a second home.

-- ─── Lists ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "contact_lists" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"       uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  "description"   text,
  -- Default true, and the default is the product decision. A list that mails
  -- whoever was typed into it is how a seller's sending reputation — which is
  -- the shared domain's reputation — is spent by somebody who did not know
  -- they were spending it.
  "double_opt_in" boolean NOT NULL DEFAULT true,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  "updated_at"    timestamp NOT NULL DEFAULT now()
);

-- Folded, unlike the spec's plain (shop_id, name). "VIPs" and "vips" are one
-- list to every seller who has ever typed both, and two lists is how half an
-- audience goes quiet.
CREATE UNIQUE INDEX IF NOT EXISTS "contact_lists_shop_name_key"
  ON "contact_lists" ("shop_id", lower("name"));

CREATE INDEX IF NOT EXISTS "contact_lists_shop_idx"
  ON "contact_lists" ("shop_id", "created_at");

-- ─── Membership ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "contact_list_members" (
  "list_id"   uuid NOT NULL REFERENCES "contact_lists"("id") ON DELETE CASCADE,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  -- The address as it read when they joined. Nullable, because a chat-rail
  -- buyer has none and is still a member; a snapshot, because who was mailed
  -- under which address is history rather than a lookup.
  "email"     text,
  -- subscribed | pending | removed. `removed` is kept rather than deleted:
  -- rule 2 turns on removal and unsubscribe being different verbs, and a
  -- seller who cannot see that somebody left a list will re-import them.
  "status"    text NOT NULL DEFAULT 'subscribed',
  -- signup | import | manual | purchase | api
  "source"    text NOT NULL DEFAULT 'manual',
  "joined_at"  timestamp NOT NULL DEFAULT now(),
  "removed_at" timestamp,
  PRIMARY KEY ("list_id", "client_id")
);

-- Recipient assembly reads (list, status) and nothing else; a `pending` member
-- is not a recipient and must not be paged past.
CREATE INDEX IF NOT EXISTS "contact_list_members_list_status_idx"
  ON "contact_list_members" ("list_id", "status");

-- The contact card's "which lists is this person on", and the reverse lookup a
-- `list.joined` trigger needs.
CREATE INDEX IF NOT EXISTS "contact_list_members_client_idx"
  ON "contact_list_members" ("client_id");

-- ─── Custom fields ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "contact_fields" (
  "id"       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"  uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  -- `^[a-z][a-z0-9_]{0,39}$`, immutable after creation, and reserved against
  -- the standard names so a custom field cannot shadow one in a merge tag.
  -- Validated in `packages/marketing/src/contacts/fields.ts`; the column
  -- trusts nothing, which is why the check constraint below exists too.
  "key"      text NOT NULL,
  "label"    text NOT NULL,
  -- text | longtext | checkbox | integer | decimal | dropdown | date | datetime
  "type"     text NOT NULL DEFAULT 'text',
  -- A closed set for `dropdown`, empty otherwise. Validated server-side on
  -- every submit: a free-text value in a dropdown field is how a validation
  -- gap becomes a CSV injection two exports later.
  "options"  jsonb NOT NULL DEFAULT '[]'::jsonb,
  "required" boolean NOT NULL DEFAULT false,
  -- contact | checkout | both — the column that makes one table serve the
  -- contact card and the checkout form.
  "scope"    text NOT NULL DEFAULT 'contact',
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_fields_shop_key_key"
  ON "contact_fields" ("shop_id", "key");

-- The checkout's read: every field this shop wants asked, in order. Partial,
-- because the common shop has none scoped to checkout and an index over rows
-- the checkout will never see is waste on the one path that must stay fast.
CREATE INDEX IF NOT EXISTS "contact_fields_checkout_idx"
  ON "contact_fields" ("shop_id", "position")
  WHERE "scope" IN ('checkout', 'both');

-- The identifier rule, in the database as well as in the validator. A merge
-- tag resolves `{{fields.key}}` by name, so a key that is not an identifier is
-- a template that renders somebody else's substitution.
DO $$ BEGIN
  ALTER TABLE "contact_fields"
    ADD CONSTRAINT "contact_fields_key_shape"
    CHECK ("key" ~ '^[a-z][a-z0-9_]{0,39}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Answers ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "contact_field_values" (
  -- Denormalised for the same reason `broadcast_deliveries` carries it: every
  -- question asked of this table is shop-scoped, and a join to ask it is a
  -- join some future call site will forget.
  "shop_id"    uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "client_id"  uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "field_id"   uuid NOT NULL REFERENCES "contact_fields"("id") ON DELETE CASCADE,
  -- jsonb because the eight types are eight shapes, and because it is the one
  -- encoding where "answered with nothing" and "never answered" are different
  -- values rather than both NULL. Blank is not zero, and rule 5 turns on it.
  "value"      jsonb,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("client_id", "field_id")
);

CREATE INDEX IF NOT EXISTS "contact_field_values_shop_field_idx"
  ON "contact_field_values" ("shop_id", "field_id");

-- ─── The checkout answer, snapshotted onto the order ─────────────────────────

-- An order must record what was answered at the time, even if the field is
-- later deleted or retyped — the same reason `orders` snapshots `variant_sku`.
-- `[{key,label,type,value}]`, resolved at write time. NULL means an order
-- placed before this shipped, which is not the same as one that answered
-- nothing: that one carries `[]`.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "custom_fields" jsonb;
