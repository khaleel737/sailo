# 36 — Cross-sells, upsell tiles, and the thank-you page

**Priority:** P1 · **Effort:** L · **Depends on:** 08 (order bumps, for the
shared offer vocabulary) · **Blocks:** nothing

## What

Three related things, one release, because they are all "what the buyer sees at
the moment of and after paying":

1. **Cross-sells** — offers shown *after* payment, on the thank-you page.
2. **Upsell tiles** — two variants of one product on a single toggleable tile.
3. **A configurable thank-you page** — copy, a redirect, and the offers above.

Reference: Easytools §`cross-sells`, §`upsells`, §`thank-you-pages`.

## After payment, not during — their reasoning, adopted

Their docs give the argument and it is the correct one:

> *"In Easycart, we show cross-sell offers after purchase - not during
> checkout. Why? Because adding friction during checkout can hurt conversions.
> According to a Baymard study, 66% of Amazon shoppers who had to go through an
> additional step with a cross-sell offer before completing the transaction
> experienced extreme frustration."*

So: **order bumps (spec 08) are in-cart and one tap; cross-sells are
post-payment and never block the receipt.** The buyer's confirmation, files and
invoice are visible before any offer is. A funnel that delays a download is a
support ticket.

## Flat, not nested — the deliberate narrowing

Theirs nests cross-sells and down-sells three levels deep with a drag-and-drop
editor: buy → skip the children, skip → see the children. It is clever and it
serves the small number of sellers running a real funnel.

**v1 ships a flat ordered list.** Reasons: a tree needs a graph editor, a
traversal engine, and a "which offer did this buyer see" ledger; and spec 30's
runner is a better home for branching logic than a bespoke traversal in the
checkout. Design the table for nesting — `parent_id` from day one, always null
in v1 — so the tree is a migration and an editor away, not a rewrite.

## Data model (migration, production first)

`drizzle/NNNN_cross_sells.sql`.

```
offers        id, shop_id → shops(cascade),
              placement text not null,   -- 'bump' | 'crosssell'
              source_product_id → products(cascade),   -- what triggers it
              offer_product_id  → products(cascade),   -- what is offered
              offer_variant_id  → product_variants(set null),
              parent_id → offers(set null),   -- always NULL in v1
              title text, body text, button_label text,
              display text default 'card',  -- card | compact | timer
              price_cents integer,          -- override; original struck through
              valid_from, valid_until,
              position integer default 0,
              is_active boolean default true,
              created_at, updated_at
              idx (shop_id, source_product_id, placement, position)

offer_events  id, offer_id → offers(cascade),
              order_id → orders(set null),
              resulting_order_id → orders(set null),
              outcome text,  -- shown | taken | skipped | expired
              created_at
              idx (offer_id, created_at)
```

Spec 08 proposed `products.bumpProductId` + `bumpHeadline`. **Supersede that
with this table** and say so in 08: one bump per product was its own stated
v1 limit, and the moment cross-sells exist the two features want the same
columns — display type, override price, validity window, position. Keep 08's
`order_items.viaBump` attribution column exactly as specified; add
`order_items.via_offer_id` alongside it.

## Behaviour

**Thank-you page.** Today it is fixed copy in 35 locales. It gains, on `shops`
and overridable per product: a headline, a body (markdown through the existing
pipeline), and an optional redirect URL with a delay. Redirect is
**opt-in and never default**, and the receipt renders first — a redirect that
fires before the buyer has their download link is a lost order.

**Cross-sell flow.** After the confirmation renders, offers for the purchased
products appear in `position` order. Each: take or skip. Taking:

- **Instant charge** where the rail allows it and nothing more is needed.
  Card only, on the buyer's existing Stripe customer and payment method from
  the original order, on the seller's connected account, through
  `createOrderIntent` — a **new order**, re-priced server-side, with its own
  invoice number. Never an amendment to the paid order.
- **Wallet** where the browser offers Apple/Google Pay and no card is on file.
- **Redirect to a normal checkout** where anything is missing — a custom field
  (spec 34), an address for a physical good, a booking slot for a service.
  This is the honest default and it must be the fallback for everything.
- **Manual rails do not get instant charge.** A cash or transfer buyer goes to a
  normal checkout. There is no stored instrument to re-use and pretending
  otherwise records a paid order nobody has paid.

**Upsell tiles.** Two variants of the same product on one tile with a toggle,
"upgrade to yearly" being the case. Purely a rendering of `product_variants`
plus a `products.upsellVariantIds jsonb` ordering — **no** pricing change, no
new order shape. Multiple upsells: one selectable at a time, structured
progressively, as theirs requires.

## Details that must not be missed

- **The server re-prices everything.** A cross-sell adds zero pricing trust:
  the offer's `price_cents` is read from `offers`, never from the browser, and
  the whole line goes through `resolveLines` / `previewOrder` /
  `createOrderIntent` like any other. The "prices from the shop, never from the
  browser" scenario already pins this — extend it, do not fork it.
- **Idempotency on instant charge.** One-click means double-click. Claim the
  offer per order with a conditional UPDATE on `offer_events` (unique on
  `(offer_id, order_id)` for `taken`) *before* calling Stripe, releasing on
  refusal — the exact shape the refund race fix used
  (`PRODUCTION-PLAN.md` §2 item 4).
- **A subscription may not be an instant-charge cross-sell.** Same rule spec 08
  states: a recurring product cannot ride a one-time basket. Offer it, route it
  to a real checkout.
- **Time-limited offers expire server-side.** Theirs: *"if a customer opens a
  cross-sell checkout that has a time-limited offer, they won't be able to
  complete the purchase once the offer expires - even if the page is still
  open."* Check `valid_until` at charge, not only at render.
- **A sold-out, unpublished or deleted offer product renders nothing** and never
  breaks the thank-you page. `set null`/`cascade` plus a render-time publish and
  stock check — 08's degradation rule, restated.
- **Cross-sell email.** Theirs mails level-1 offers. Ours mails the flat list,
  through `broadcasts/render.ts`, and only where the buyer may be mailed.
- **Currency must match** the source order. One shop, one currency today, so
  this is an assertion rather than logic — write the assertion, because
  presentment currency already varies (`0030_adaptive_pricing_presentment`).
- **`offer_events` is how the seller learns anything.** Take-rate per offer =
  taken / shown. Write `shown` when it renders, or the denominator is a guess.
- 35-locale strings: thank-you defaults, offer buttons, expiry copy, the
  offer editor.

## Testing

Unit: offer eligibility (active, in window, published, in stock, currency,
not-a-subscription-for-instant-charge); take-rate arithmetic; the flat ordering.

Scenario: pay → confirmation renders **before** any offer; take an offer →
a second, separately-numbered, correctly-taxed order; double-click charges
once; skip → `skipped` event; expired offer refuses at charge even when the
page was opened in time; manual-rail buyer is routed to checkout and no order
is marked paid; a forged `price_cents` from the client is ignored; an
unpublished offer product renders nothing; bump + cross-sell on one purchase
attribute to the right columns.

## Done when

A buyer sees their receipt first and an offer second, one tap creates a real
re-priced order with its own invoice, nothing double-charges, expiry is
enforced at the charge, manual rails never fake a payment, and the seller can
read take-rate per offer.
