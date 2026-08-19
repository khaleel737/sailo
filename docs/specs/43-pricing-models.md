# 43 — Pricing models: pay-what-you-want, donation, sell windows, manual trials

**Priority:** P1 · **Effort:** M · **Depends on:** nothing ·
**Blocks:** 33 (waitlists need the sell window)

## What

Four holes in one table, closed by one migration. Reference: Easytools
§`pricing-models`, §`pay-what-you-want`, §`temporary-prices`, §`free-trials`.

| Their model | Sailo today |
|---|---|
| Single payment | ✅ |
| Subscription | ✅ card and manual rails |
| Free trial | ⚠️ `trialDays`, Stripe rail only — the form says so |
| Payment plan / installments | ❌ **refused**, see below |
| Pay what you want | ❌ |
| Lead magnet / zero price | spec 07 |
| Donation | ❌ |
| Temporary / windowed prices | ❌ |
| Net price priority, inclusive/exclusive tax | ✅ |
| Crossed-out compare-at price | ✅ `compareAtCents` |

## Data model (migration, production first)

`drizzle/NNNN_pricing_models.sql`. All nullable or defaulted to reproduce
today's behaviour exactly, in the style of `0034_product_kinds.sql`.

```
products
  pricing_mode text default 'fixed' not null    -- fixed | pwyw
  min_price_cents integer                        -- pwyw floor (may be 0)
  suggested_price_cents integer                  -- pwyw default in the field
  sell_from timestamp
  sell_until timestamp
  hide_when_unavailable boolean default false not null

product_variants
  sell_from timestamp
  sell_until timestamp
```

**No `donation` product kind.** A donation is `pricing_mode = 'pwyw'` with
`min_price_cents = 0` on a `digital` product with no file. Adding a sixth kind
would fork every `switch` on `ProductKind` in the tree — fulfilment, the
storefront tile, the order line, the CSV, the API resource shape — to express a
thing that is entirely a *pricing* difference. The product-template picker can
still offer "Donation" as a preset that sets these three columns; a template is
not a kind.

**Windows on both product and variant**, because theirs does and the reason is
real: an early-bird variant expires while the product keeps selling.

## Pay what you want

- The checkout renders an amount field, prefilled with `suggested_price_cents`,
  with `min_price_cents` as the floor.
- **The floor is enforced server-side in `resolveLines`**, and this is the entire
  security content of the feature. `priceCents` for a PWYW line comes from the
  request — the only place in the whole checkout where that is true — so it must
  be clamped, validated as an integer in minor units, and re-clamped in
  `previewOrder` **and** `createOrderIntent`. Two clamps, because
  `PRODUCTION-PLAN.md`'s recurring bug shape is "guard applied at one sink not
  its twin", and the price path has exactly two sinks.
- **Minor units, not a float.** The three-decimal currency defect (five
  currencies quoted to three places and settled to two) is the standing warning:
  parse through the existing `parseMoneyToCents`, never `parseFloat(x) * 100`.
- **Coupons on PWYW.** A percentage coupon on a buyer-chosen amount is
  well-defined; a fixed-amount coupon that exceeds the chosen amount must clamp
  to zero and not go negative. `min_price_cents` is a floor on the **entered**
  amount, not on the amount after discount — otherwise a legitimate coupon is
  refused. Say which in the code; both are defensible, this one is theirs.
- **Zero is allowed only when `min_price_cents = 0`,** and a zero-total order
  must take the free path that already exists (no payment intent, immediate
  release where appropriate) rather than creating a zero-value charge.
- **Not for memberships.** A recurring buyer-chosen amount means a Stripe Price
  per buyer. Refuse it on `kind = 'membership'` with a message, the way coupons
  on memberships are already refused rather than silently ignored.
- PWYW lines are excluded from `compareAtCents` struck-through rendering — there
  is no "was" price.
- Analytics: PWYW average received vs suggested is the one number a seller wants.
  One tile, from `order_items`.

## Sell windows (temporary prices)

- **Availability is computed, never stored.** `sellFrom`/`sellUntil` compared to
  now, in `shops.timeZone` where a seller typed a date rather than a datetime.
  A stored `isAvailable` flag drifts the moment a cron misses a tick.
- Where a window closes, `hide_when_unavailable` decides between hiding the
  product and showing it as unavailable. Theirs offers both and sellers want
  both — a launch that has ended should often stay visible with a waitlist.
- **This is spec 33's trigger**: outside the window is one of the
  unavailability cases the waitlist form appears for.
- **Sales close server-side.** An expired window must be refused in
  `resolveLines`, not merely hidden — a page opened before expiry must not
  complete after it, which is the same rule spec 36 applies to offer expiry.
- **Storefront cache.** The product page is `"use cache"` + `shopTag`, and a
  window boundary is *time*-based rather than write-based, so nothing revalidates
  it. Either set a `revalidate` bound to the nearest boundary, or exclude
  windowed products from the cached path. **Pick one and write down which** —
  three caches in this repo have silently stopped working before and a window
  that expires invisibly is the same failure.
- Variant windows narrow the product's, never widen it.

## Manual-rail free trials

`trialDays` exists and is Stripe's `trial_period_days`; nothing else reads it,
so a trial set on a cash or transfer membership does nothing today, and the
product form says so beside the field. Spec 06's notes name this and say making
it real is a money-path change worth doing on its own. This is that.

Shape: the signup order is **zero-value** and marked paid immediately;
`subscriptions.current_period_end` is set to the trial end; the first *paid*
period is raised by the existing manual-renewal cron when the trial lapses,
with the same five-day lead and the same `renewal_ordered_for` claim.

The trap: a zero-value signup order must not enter revenue, the invoice sequence,
or the abandoned-checkout sweep. The membership sweep exemption already exists;
the revenue and invoice exclusions must be added and grepped for a second copy.

## Payment plans / installments — refused

Their model is a fixed-term subscription, and Sailo has the parts
(`billingInterval` + `billingIntervalCount`). The refusal is about the money
path, not the schema: partial delivery against partial payment, what a failed
third instalment does to access already granted, and refunds spanning
instalments. That is a release of its own with its own scenario suite.
See `GAP-2026-08-easytools.md` §4.7.

## Details that must not be missed

- **`min_price_cents = 0` and `min_price_cents = NULL` mean different things.**
  Zero is "free is allowed"; null is "not configured" and must be treated as
  "floor equals `priceCents`". Blank ≠ zero, again.
- **The API and webhook resource shapes** (`packages/core/src/wire/resources.ts`, shared by both
  surfaces per spec 16) must carry `pricing_mode` and the chosen amount, or an
  integration will report the list price for a PWYW sale.
- **CSV export and the invoice** show the amount actually paid, which they
  already do because both read the order line. Assert it.
- Plan gate: PWYW and sell windows on Pro; nothing here on Business only.
- 35-locale strings: the amount field and its floor message, "not yet on sale" /
  "no longer available", the donation preset, the trial note.

## Testing

Unit: the floor clamp at both sinks, over integer, float-string, negative,
`Infinity`, `NaN`, a value below the floor, and a three-decimal currency;
percentage and fixed coupons against PWYW including a coupon exceeding the
amount; window availability across a DST boundary in a non-UTC shop timezone;
variant window narrowing but not widening.

Scenario: a PWYW order charges the entered amount and a forged lower one is
clamped; a zero PWYW order with a zero floor takes the free path and creates no
charge; PWYW on a membership is refused with a message; a product outside its
window is refused at `resolveLines` even from a page opened earlier; a manual
trial signup writes a zero-value order that appears in neither revenue nor the
invoice sequence, is not swept, and raises a real paid order at trial end under
two concurrent cron ticks.

## Done when

A seller can be paid what a buyer chooses above a floor the server enforces at
both sinks, can open and close sales on a schedule the server honours, can offer
a trial on a cash membership without breaking revenue or the invoice sequence,
and no sixth product kind was added to express any of it.
