-- Spec 41 — the seller's own legal pages, and the loop it closes.
--
-- `shops.require_terms` has been enforced server-side since 0011: the checkout
-- refuses without the box ticked and stamps `orders.terms_accepted_at` from the
-- server's clock. What it has never had is anything to point the buyer at.
-- `shops.terms_url` is a link to somebody else's web host, most sellers paste
-- nothing, and so the switch stays off.
--
-- This table is the document. One row per kind per shop, holding the *rendered*
-- markdown rather than the answers it was generated from, because a seller edits
-- it afterwards and a regeneration must not silently discard their edits.
--
-- WHY IT MATTERS BEYOND THE CHECKOUT
--
-- 0035 gave every order a `terms_snapshot_id`, and `policies.ts` documents three
-- sources for that text which are not equally trustworthy. `url_fetch` is the
-- weak one: an issuer following a seller's `terms_url` four months after the
-- sale reads whatever is on that host *today*, and a URL that changed is not
-- evidence. A shop page is the good path — the text is ours, it cannot change
-- under us, and no network is involved at checkout — so orders placed after this
-- lands snapshot `body_md` directly with `source = 'shop_page'`.
--
-- Nothing here changes an existing shop: the table is new, `privacy_url` is
-- nullable, and a shop with no rows renders exactly as it did.

CREATE TABLE IF NOT EXISTS "shop_pages" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id"          uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,

  -- terms | privacy | refunds | about | faq
  "kind"             text NOT NULL,
  "slug"             text NOT NULL,
  "title"            text,

  -- The rendered template, then seller-edited. Stored rendered rather than as
  -- the answers, so regenerating is a decision the seller makes against a diff
  -- rather than something that happens to their words.
  "body_md"          text,

  -- Which template produced it, so a template fix can list the shops still on
  -- an old one without touching anybody's edits.
  "template_version" text,

  -- generated | custom
  "source"           text NOT NULL DEFAULT 'generated',

  "is_published"     boolean NOT NULL DEFAULT false,
  "created_at"       timestamp NOT NULL DEFAULT now(),
  "updated_at"       timestamp NOT NULL DEFAULT now()
);

-- One row per kind: a shop has one privacy policy, not a list of them.
CREATE UNIQUE INDEX IF NOT EXISTS "shop_pages_shop_kind_key"
  ON "shop_pages" ("shop_id", "kind");

-- And one page per URL. Both are needed: the kind is what the admin edits and
-- the slug is what `/[handle]/legal/[slug]` resolves.
CREATE UNIQUE INDEX IF NOT EXISTS "shop_pages_shop_slug_key"
  ON "shop_pages" ("shop_id", "slug");

-- The storefront reads the published set for a shop — the footer links, the FAQ
-- accordion and the About block all come from one pass.
CREATE INDEX IF NOT EXISTS "shop_pages_shop_published_idx"
  ON "shop_pages" ("shop_id", "is_published");

-- The privacy policy's own link, beside `terms_url`.
--
-- Its own column rather than reusing `terms_url`, because the two are shown in
-- different places and mean different things: terms is what the buyer agrees to
-- at checkout, privacy is what the shop must disclose whether or not anybody
-- agrees to anything. Sharing one column would make turning on `require_terms`
-- silently republish the privacy policy as the thing being agreed to.
ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "privacy_url" text;
