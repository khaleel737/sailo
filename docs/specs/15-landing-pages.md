# 15 — Landing Pages & Funnels

**Priority:** P3 · **Effort:** L · **Depends on:** nothing (08 makes funnels
more useful)

## What

Standalone pages a seller composes from blocks — headline, text, image,
video embed, product CTA, lead form — living at their own URL for
link-in-post campaigns. "Funnels" in Stan is chaining these (page →
checkout → thank-you with an upsell); v1 here is single pages, with chaining
as phase 2. Reference: Stan's "Landing Pages" tab and Funnels toggle.

## Data model (migration, production first)

`landingPages`: id, shopId, slug (unique per shop, same normalisation rules
as product slugs), title, `blocks jsonb`, isPublished, createdAt, updatedAt.
Block schema (zod-validated on save, versioned with a `v` field):

```ts
{ v: 1, blocks: Array<
  | { type: "heading";  text: string }
  | { type: "text";     markdown: string }
  | { type: "image";    blobUrl: string; alt: string }
  | { type: "embed";    provider: "youtube" | "spotify"; id: string } // spec 21 rules
  | { type: "product";  productId: string; style: "card" | "button" }
  | { type: "leadForm"; productId: string }                            // spec 07 lead product
> }
```

## Routes & rendering

- Public: `/[handle]/l/[slug]` next to the existing product route family.
  Cached like the storefront: `"use cache"`, `cacheLife("max")`,
  `cacheTag(shopTag(shopId))` so publishing/editing revalidates with the
  shop (same invalidation the product pages use — read
  `src/lib/queries/products.ts`'s caching comments first).
- Product blocks resolve through the existing public product queries so an
  unpublished product silently drops from the page rather than 404ing it.
- Visits: track with the existing `/api/track` beacon, `productId` null —
  consider a `landingPageId` column on visits only if per-page analytics is
  demanded; v1 counts them as storefront visits.

## Editor

Server-action CRUD; the editor is a vertical block list with add / remove /
reorder (up-down buttons — no drag-drop dependency in v1), a preview pane
reusing the storefront renderer, and a publish toggle. Images upload through
the existing `/api/upload` path (already rate-limited per shop).

## Details that must not be missed

- Seller markdown renders through a sanitising renderer — no raw HTML block
  type, ever (that's stored XSS on a public page). Whatever markdown pipeline
  the blog uses (`src/lib/blog.ts`) is the reference; strip on render, not
  on save.
- Slug collisions with reserved words: the route lives under `/l/` so it
  cannot shadow products or system pages — keep it that way rather than
  offering root-level slugs.
- Page count plan-gated: e.g. 1 on free, 10 on pro, unlimited business —
  `landingPages` limit in `src/lib/plans.ts` `Limits`, enforced in the
  create action with the upgrade modal.
- SEO: pages get title/description meta and are added to the shop's sitemap
  only when published.
- Deleting a referenced product: `productId` in blocks is data, not an FK —
  render-time resolution already handles absence; the editor should flag
  dead references.
- 35-locale admin strings for the editor; page *content* is seller-authored.

## Testing

Scenario: create → publish → public route renders blocks, unpublished
product block drops out, edit revalidates the cache (assert via the tag
path), plan limit refuses the N+1th page with the upgrade shape. Unit: block
schema rejects unknown types and raw-HTML smuggling in markdown.

## Done when

A seller can compose, publish, and edit a cached, sanitised landing page
with product CTAs and a lead form, within plan limits.
