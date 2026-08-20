# 03 · Home (Dashboard)

**0.5s shape:** "what do I do next?" — a store preview, one question box, and a
grid of task cards. NOT a wall of analytics; the numbers move to /admin/analytics (08).

## Digested captures
- Home = **store preview card** (dark browser-frame mock of the storefront w/
  name + domain + Private chip) → big friendly headline ("You've got a product
  to sell / What do you want to work on next?") → **ask bar** (AI input,
  "Is my store live?", + and ↑ buttons) → **task cards grid**: 2 large
  (Launch store w/ rocket illustration; Accept payments w/ card logos) then a
  3-up row (custom domain w/ €15 back eyebrow; shipping rates; country setup
  "0 tasks completed" ring) then 2-up (market setup "1 of 5 ✓ + Next task"
  line; EU withdrawal prep). Every card: heading, 1–2 lines, playful 3-D
  illustration bottom-right, ONE button bottom-left. Progress rings on
  checklist cards.
- With data (earlier capture): Home stays task-first; metrics strip small.

## Sailo mapping
Have: hero link card (keep — it IS our store-preview equivalent), setup
checklist, stat tiles + charts + panels (these MOVE in P6), share/QR.

## Target layout (after P6 split)
1. Hero shop-link card (unchanged) + Share QR
2. **Setup checklist as task-card grid** — upgrade the current checklist rows
   into Shopify-grammar cards: title, one line, illustration slot (reuse our
   drawn SVG art style — parcel/tags/envelope/people + 2 new: rocket-parcel
   "Publish shop", card-stack "Get paid"), single CTA, progress ring where a
   card wraps multiple steps. Lottie only on the two hero cards (existing policy).
3. **KPI strip** (4 small tiles w/ sparklines — today's snapshot) linking to
   /admin/analytics; charts/traffic/performance/funnel move there.
4. Recent orders (keep, 5 rows) · Referral card (keep)
5. **Ask-bar slot**: spec'd, not shipped — a disabled-until-backend input is a
   lie; reserve the layout slot, build when an endpoint exists.

## Motion
Progress rings animate on first paint only (draw 300ms ease-out); cards have
hover lift = shadow only (no scale — layout stability rule).

## Tasks (P6)
- [x] Task-card grid + header progress ring (draws once on first paint, reduced-motion still)
- [x] Checklist → cards; CardsArt + LinkArt drawn in the empty-state hand
- [x] KPI strip stays as a fixed 30-day snapshot linking to /admin/analytics; charts/traffic/performance/funnel moved
- [x] Ask-bar omitted until a backend exists — decided, not deferred
