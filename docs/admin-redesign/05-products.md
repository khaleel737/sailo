# 05 · Products

**0.5s shape:** list = a comparable catalogue table. Detail = a two-column
record: the thing on the left, the facts about it on the right.

## Digested captures (product detail — the densest screen in the set)
- **Header:** breadcrumb tag-icon › title + `Active` chip; right: Preview ·
  Share · More actions ▾ · **↑ ↓ prev/next record arrows**.
- **Left column:** Title input → Description (full rich-text toolbar: AI wand,
  paragraph select, B/I/U/A, align, link/image/video/table, `</>`) → **Media
  grid** (first image 2×2 large, rest 1×1, trailing + tile) → **Category**
  select with ✨ *suggested chip* ("Polos in Clothing Tops — Suggested ✕",
  purple text, accept-or-dismiss) → **Variants matrix**: option rows (drag
  handle ⠿, name, value chips) + "Add another option"; then `Group by Color ▾`,
  search/filter icons; grouped rows w/ image placeholder, "6 variants" subtitle,
  inline € price inputs, Available count, per-row expand ▾; footer note
  "Inventory is not stocked at <location>" → Product metafields row →
  **Search engine listing** card (Google-style preview: site name, URL path,
  blue title, description, price) w/ ✎.
- **Right rail (top→bottom):** Status card (select) → **Publishing** (channels
  list + manage ⚙) → **Sales** ("No recent sales" + View details link) →
  **Product organization** (Type / Vendor / Collections chips / Tags chips,
  each with ⊕) → Theme template select.
- Save: dirty top bar + disabled bottom Save.

## Sailo status
List: table + import/export + empty art ✓. Create: 5-step guided flow ✓ (keep —
our creation story BEATS Shopify's single page for first-time sellers).
Edit: single long column — the gap.

## Target: Edit = two-column record (P5)
Left: existing cards in current order (basics / pricing / kind panel / stock).
Right rail (sticky, 20rem):
1. **Status** — isPublished+inStock+isFeatured as the visibility card MOVED here
   (from bottom!) — status belongs beside the title, not after the scroll.
2. **Sales** — units + revenue for this product (query exists in performance
   panel) + "View analytics" link.
3. **Organization** — category select + tags (move from pricing card).
4. **Storefront** — View on shop link + share QR button.
Header: back › title + Live/Hidden chip; Preview (→ /{handle}/p/{slug}),
More-actions ▾ (duplicate*, delete), **prev/next** within the catalogue
(ordered as the list). *duplicate = new action, small.
SEO card: we have none — spec a listing-preview card reading title/description
(slug shown, editable later); P5 stretch.
Description toolbar: markdown-lite toolbar reuse from broadcasts editor (bold/
italic/link/list) — NOT a full RTE; matches our storefront renderer.

## Media (files) — Content→Files capture
Full asset-manager page is OUT of scope (our images live per-product, storage
package has no browse API). Spec notes it as a future `Content` module; the
uploader's drag-drop batch (done) covers the daily need.

## Tasks
- [x] P5: two-column edit layout + right-rail cards + prev/next + header chips (2026-08-20, browser-verified)
- [ ] Category-suggestion SLOT — deferred: a slot behind a disabled flag is dead code until the endpoint exists; build both together
- [x] Duplicate product action (`@sailo/commerce` batch copy, cap enforced, pin 165→166)
- [ ] SEO preview card — stretch, still open; candidate for P8 sweep
- [x] Variant audit: VariantEditor already has per-row inline price inputs with inherit-placeholder semantics — parity holds, no change
