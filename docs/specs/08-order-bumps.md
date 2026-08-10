# 08 — Order Bumps (checkout upsell)

**Priority:** P2 · **Effort:** M · **Depends on:** nothing

## What

A seller attaches one companion product to a product; at checkout the buyer
sees a one-tap "Add X for $Y" box above the pay button. Reference: Stan's
"Order Bumps" (Creator Pro-gated there; gate ours behind `pro`).

## Data model (migration, production first)

`products.bumpProductId uuid` referencing products (nullable,
`on delete set null`), plus `bumpHeadline text` (nullable — falls back to a
localised default). One bump per product in v1; a join table only if demand
appears.

## Behaviour

- Admin product form: a "bump" picker listing the shop's own published
  products (exclude self, exclude lead kind, exclude membership kind — a
  subscription cannot ride a one-time basket, spec 06 rule).
- Checkout panel: render the bump as a checkbox row with price; ticking it
  adds a **normal line** to the basket client-side.
- **The server re-prices everything** — this feature adds zero pricing trust:
  the bump line goes through `resolveLines`/`previewOrder` and
  `createOrderIntent` like any other line (the "prices from the shop, never
  from the browser" scenario already pins that). Server-side, the only new
  validation is none: a buyer adding any purchasable product to the basket
  was already legal.
- Attribution: `order_items.viaBump boolean default false` so Income can
  filter and the seller can see whether bumps convert. Set server-side only
  when the line's productId equals the parent line's bumpProductId in the
  same order — not from a client flag.
- Stock/booking rules apply unchanged (a sold-out bump simply doesn't render:
  `unitsLeft` is already in the preview payload).

## Details that must not be missed

- Deleting or unpublishing the bump product must degrade silently
  (`set null` + render-time publish check) — never a broken checkout.
- A bump product with variants needs a default variant or is ineligible for
  bumping in v1 (picker filters variant products out; say why in the UI).
- Currency is per-shop so no mixed-currency risk; tax flows through
  `computeTotals` untouched.
- Analytics: bump take-rate = orders with viaBump / orders offering a bump —
  keep as a follow-up; only the column lands now.
- 35-locale strings for the default headline and the admin picker; plan flag
  `orderBumps` in `src/lib/plans.ts` (pro+), upsell via the existing upgrade
  modal pattern.

## Testing

Scenario: order with bump line totals correctly (tax on, coupon on — coupon
minimum-spend counts the bump line via `cartSubtotal`); `viaBump` set only by
the server rule; sold-out bump renders nothing and a forged viaBump flag from
the client is ignored.

## Done when

Bump renders, adds a re-priced line, attributes server-side, degrades safely,
and the pricing scenarios stay green.
