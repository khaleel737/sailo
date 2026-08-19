# 35 — Testimonials (wall of love)

**Priority:** P2 · **Effort:** M · **Depends on:** nothing ·
**Blocks:** nothing

## What

Shop-level social proof: collected by sending a link to a past buyer, curated,
displayed on the storefront, shown in the checkout, and embeddable on a site
the seller hosts elsewhere. Reference: Easytools Testimonials / Easylove,
`llms-full.txt` §`collect-testimonials` onward.

## Why this is not `reviews`

`reviews` is `(shopId, productId, authorName, rating 1..5, body, isApproved)`.
It answers *"what do buyers think of this product"*, renders on the product
page, and is correct as it stands. Do not extend it.

A testimonial answers *"should I trust this seller"*. It is shop-scoped, has no
rating, carries an avatar and optionally a video, is **solicited** by link
rather than volunteered, and is rendered in places a review never is —
the checkout, and a third party's website through an iframe.

Building it as a `productId`-null review would put an unrated, embeddable,
externally-served object into the query that renders product pages — and that
query is `"use cache"` + `cacheTag(shopTag(shopId))`. One table, two audiences,
two cache lifetimes, one leak away from a draft testimonial on a public page.
Separate tables.

## Data model (migration, production first)

`drizzle/NNNN_testimonials.sql`.

```
testimonial_walls  id, shop_id → shops(cascade), name, slug,
                   headline, layout text default 'grid', -- grid | carousel
                   is_published boolean default false,
                   embed_key text not null,   -- opaque, rotatable
                   created_at, updated_at
                   unique (shop_id, slug)
                   unique (embed_key)

testimonials       id, shop_id → shops(cascade),
                   wall_id → testimonial_walls(set null),
                   product_id → products(set null),
                   author_name text not null, author_role text,
                   author_avatar_url text,
                   body text, video_url text,
                   source text,  -- requested | manual | imported
                   client_id → clients(set null),
                   is_approved boolean default false,
                   is_featured boolean default false,
                   position integer default 0,
                   submitted_at, created_at
                   idx (shop_id, is_approved, position)

testimonial_requests  id, shop_id → shops(cascade),
                      client_id → clients(set null),
                      email text not null,
                      token_hash text not null,
                      product_id → products(set null),
                      sent_at, submitted_at, expires_at
                      unique (token_hash)
                      idx (shop_id, sent_at)
```

`wall_id` nullable so a testimonial can exist before a wall does, and so
deleting a wall does not destroy the content. `product_id` nullable so a
testimonial can be about the shop rather than a thing.

## Behaviour

**Requesting.** The seller picks buyers (from `clients`, filtered by the same
segment vocabulary) and sends a request. Each is a `testimonial_requests` row
with a hashed token — hashed, not stored plain, the rule `door_passes` and the
download tokens already follow. The link opens a public page: name, role,
avatar upload, text, optional video URL. Submitting writes an **unapproved**
testimonial.

Requests count against the broadcast quota and respect suppressions. They are
transactional in substance (you bought this, tell us) but they are bulk mail in
shape, and the ceiling exists for the shape.

**Curating.** A moderation list: approve, feature, reorder, delete. Nothing is
public until approved — default `false`, same as `reviews`, and for the same
reason: a public writable surface without a gate is a spam target.

**Displaying.** Three surfaces:

1. **Storefront section** — an optional strip under the products, ordered by
   `position`, approved only, riding `shopTag` so approving revalidates.
2. **Checkout** — theirs shows testimonials in the cart and it converts. Cap it
   at three and render server-side; the checkout must not gain a fetch.
3. **Embed** — `/embed/wall/[embedKey]`, an iframe-able page. See below.

## The embed, which is the only risky part

- Served from its own route with **its own CSP**, `frame-ancestors *`, and
  nothing else on the page: no admin bundle, no auth cookie read, no analytics.
- `embed_key` is opaque and rotatable, and it is **not** the shop id or handle.
  A guessable key is an enumeration of every shop's marketing copy.
- Rate-limited per key.
- `X-Frame-Options` must **not** be set on this route while the rest of the app
  keeps it. Check the shared header config — a global `DENY` will silently make
  this feature not work, and the failure appears only inside somebody else's
  website.
- `author_avatar_url` and `video_url` go through the **existing SSRF and
  allowlist guards** at the write, not at render. `PRODUCTION-PLAN.md` §2 item 2
  is exactly this bug: `apps/web/src/lib/og.tsx` fetching any URL it was handed, from public
  unauthenticated routes. Four writes had to be fixed. This is a fifth and
  sixth — do it at the write.
- `video_url` is an allowlisted embed host only (YouTube, Vimeo) and is rendered
  as a link-with-thumbnail or a sandboxed iframe, never an arbitrary `<iframe>`
  from seller input.

## Details that must not be missed

- **Google review import is refused for v1.** It needs a Places API key per
  seller and carries Google's attribution and caching terms. Manual entry with
  `source = 'imported'` covers the actual need; the API does not ship.
- **A testimonial is not a review and must not enter any rating aggregate.**
  Grep the product page for the average-rating computation before adding
  anything shop-scoped near it.
- **Deleting a client `set null`s the testimonial** and keeps it. Account
  deletion (spec 03) retains the ledger; the same logic applies to published
  marketing the seller is relying on. But it must stop being *attributable*:
  the author name stays because they typed it, the `client_id` goes.
- **Video is a URL, never an upload.** Storing video in Blob is a bandwidth
  and moderation surface for a feature that does not need it.
- **Plan gate:** collection and one wall on Pro; multiple walls and the embed
  on Business.
- 35-locale strings: request email, public submit page, moderation list,
  storefront section, settings.

## Testing

Unit: token hashing and expiry; the embed key generator's entropy; the avatar
and video URL guards against every notation `packages/core/src/net/ip.ts` unwraps, plus a
`Location`-header redirect attempt (`redirect: "manual"` rule).

Scenario: request → public submit → unapproved row → not on storefront →
approve → storefront revalidates on `shopTag`; a second submit on a used token
is refused; an expired token is refused; the embed route serves approved-only
and 404s an unknown key; a rotated key invalidates the old one; a suppressed
address gets no request.

E2E: the embed renders inside a cross-origin iframe in a real browser — this is
the assertion that catches a global `X-Frame-Options`, and nothing else will.

## Done when

A seller mails past buyers, curates what comes back, shows it on the storefront
and in the checkout, and pastes one iframe into a Framer or Squarespace site
that renders — with every author-supplied URL guarded at the write.
