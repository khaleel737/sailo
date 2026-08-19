# 53 — Regional pricing

**Priority:** P1 · **Effort:** M · **Depends on:** nothing · **Blocks:** nothing

## What

A visitor in Berlin sees `€25,00`, a visitor in London sees `£22.00`, and both
of them see it **on the storefront**, not for the first time on Stripe's page.
The number in each currency is one the seller typed. Nothing here converts
anything.

`README.md`'s "Not built yet" opens with this line: *"Flat USD today; localised
pricing lifts conversion sharply."* Scoped, per `RESHAPE-2026-08.md`, to the
markets Sailo is going after — **the US, the EU and the UK** — which makes it a
multi-currency problem before it is anything else.

## What already exists, and what it does not cover

**Half of this is built, on the rail that matters most.** Stripe's Adaptive
Pricing is on for storefront card checkout
(`packages/commerce/src/orders/card-checkout.ts`, `adaptive_pricing: { enabled:
true }`), and the Connect webhook records what the buyer actually paid into
`orders.presentmentCurrency` / `presentmentAmountCents`
(`drizzle/0030_adaptive_pricing_presentment.sql`).

So the first question this spec had to answer was the one the assignment asked
for: **does Adaptive Pricing already cover the card rail well enough for v1?**

**It covers the charge. It cannot cover the price.** Three findings, from
source:

1. Adaptive Pricing decides the buyer's currency **inside Stripe's hosted
   page**, after the buyer has left the storefront. Everything before that —
   the product card, the buy box, the cart sheet, the basket total, the
   shipping fee, the order-preview panel — is `formatMoney(cents,
   shop.currency, locale)`. The decision to buy is made on the card, and the
   card is ours.
2. Its conversion is **Stripe's rate at session time**, which is a number no
   seller chose and no page can show in advance. A storefront that displayed it
   would be quoting a rate that can move between the render and the redirect —
   exactly the price a buyer never agreed to.
3. It is **not in the manual and chat rails at all**. Bank transfer, cash on
   delivery and the WhatsApp handoff never create a Stripe session, so a Berlin
   buyer paying by transfer is quoted the shop's currency and always will be.

The conclusion, said out loud rather than built around: **Adaptive Pricing stays
exactly as it is and this spec adds no second conversion.** What it adds is a
price the seller chose, shown before the buyer commits, on every rail. Where a
shop has no price in the visitor's currency, Adaptive Pricing keeps doing what
it does today and this feature is inert.

## The rule that decides the shape

> **The seller types the number. Sailo never invents one.**

No live FX rates in v1, and not as a cost-saving: a rate that moves between the
price shown and the order written is a price the buyer never agreed to. A
seller-typed price is also a price that can be *rounded to read well* —
`€25,00`, not `€26,73` — which no conversion will ever do, and which is most of
the conversion lift this feature exists for.

`orders.taxCents` already carries the argument for snapshots over
re-derivation. It is the same argument, and it applies harder here.

## Data model (migration, production first)

`drizzle/0036_regional_pricing.sql`. **No new tables** — four jsonb columns and
one array, all defaulted, so an existing catalogue reads and sells identically
the moment it lands (the rule `0034_product_kinds.sql` set).

```
shops.regional_currencies   text[] not null default '{}'
                            -- ISO 4217, uppercase, never the shop's own

products.currency_prices        jsonb not null default '{}'
product_variants.currency_prices jsonb not null default '{}'
                            -- { "EUR": { "price": 2500, "compareAt": 3000 } }

delivery_methods.currency_prices jsonb not null default '{}'
                            -- { "EUR": { "price": 400, "freeOver": 5000 } }

coupons.currency_prices          jsonb not null default '{}'
                            -- { "EUR": { "price": 500, "minSubtotal": 2000 } }
```

**A column, not a table, and that is a decision.** The fact being stored is
"what this row costs in currency C" — an attribute of the row, read on every
path that already reads the row, and written by the same form that writes
`price_cents`. A `product_prices` table would add a join to the storefront
catalogue query, the cart, the buy box, `resolveLines`, the admin product form
and the CSV importer, to carry at most nine small integers per product.
`RESHAPE-2026-08.md`'s ledger — *"Everything else is columns on tables that
exist"* — is the same judgement.

One shared shape (`price`, plus at most one secondary amount) across all four,
so one validator and one reader serve them.

**Amounts are minor units in their own currency**, decided by
`currencyDecimals` — not by a flat 100. `chargeStep` in
`packages/core/src/money/currency.ts` already knows about the zero- and
three-decimal currencies and is the only rounding rule; this adds no second
one.

## Which currencies

`REGIONAL_CURRENCIES` in `packages/core/src/money/regional.ts` — the US, the
EU and the UK, and nothing else:

```
USD  EUR  GBP  SEK  DKK  PLN  CZK  HUF  RON
```

Every euro-area country maps to EUR; `GB` to GBP; `SE`, `DK`, `PL`, `CZ`, `HU`,
`RO` to their own; `US` to USD. **Every other country maps to nothing** and
gets the shop's own currency, which is what it gets today.

A deliberately short list. Sailo supports seventy-one currencies as a *shop*
currency; offering all of them as presentment currencies would be seventy-one
prices per product to keep in step, and the market this release is written for
is nine of them.

## Choosing the currency for a visit

Server-side, in this order:

1. The `sailo_ccy` cookie, if the visitor used the switcher **and** the shop
   still offers that currency.
2. `x-vercel-ip-country` — the header `apps/web/src/lib/auth.ts` already reads —
   through the country → currency map.
3. The shop's own currency.

Never `Accept-Language`: a German-speaking buyer in London is a GBP buyer, and
language is not location.

The switcher is a plain form posting to a server action that sets the cookie
and revalidates — no client state, and the chosen currency is a fact the server
holds when it prices the order.

## Completeness, and the one thing that must not happen

**A half-configured currency must never show a converted guess.** The failure to
design against is a catalogue where product A has a EUR price and product B does
not, and B is rendered at its USD integer with a `€` in front of it. That is not
a display bug; it is a wrong price on a page a buyer can buy from.

So the unit of offering is the **shop**, not the product:

> A currency is *live* for a shop when **every published product, every priced
> variant, every enabled delivery method and every active coupon that names an
> amount** has a price in it.

`liveCurrencies(shopId)` answers that in one query, `"use cache"` +
`cacheTag(shopTag(id))`, so it is revalidated by the same writes that already
revalidate the storefront. A currency the seller has enabled but not finished
pricing is **not offered to any buyer** and the settings card names exactly what
is missing — rule 8, no silent caps, applied to the seller rather than to the
buyer.

Where no currency is live, the visitor gets the shop's own and is told nothing.
That is today's behaviour, unchanged.

## The order

**The order is written in the currency the buyer was charged, and the invoice
states that currency.** `orders.currency` is already per-order and already
snapshotted; nothing is re-derived at read time and no rate is stored, because
none was used.

`resolveOrderIntent` takes the resolved currency and threads it where
`shop.currency` goes today — `resolveLines`, `resolveDelivery`, `resolveCoupon`,
`toChargeableTotals`. Each reads the row's `currency_prices` through one
function, `atCurrency(row, currency)`, which returns the row with `priceCents`
and its secondary amount replaced. Every downstream reader — `variantPrice`,
`quote`, `computeTotals`, the buy box, the cart, the Stripe line items — is
unchanged, because it is still reading a row with a price on it.

**`atCurrency` never falls back.** A row with no price in the requested currency
returns `null`, and a checkout that hits one **refuses and re-prices in the
shop's currency** rather than charging a number nobody set. That window only
exists between a seller unpublishing a price and the cache turning over, and it
is a check-then-act gap if it is handled any other way.

**Adaptive Pricing stays on.** When the session currency already is the buyer's,
it does nothing; when the buyer is somewhere the shop has no price for, it does
what it does today. Turning it off would remove iDEAL, Bancontact, BLIK and P24
from every shop for no gain.

## What this does to the books, and what is done about it

A shop with EUR live takes orders in USD and in EUR. Seventeen call sites sum
`orders.total_cents` for a shop and format the result in `shops.currency`; for
every shop that has not enabled a second currency, they stay exactly correct,
because every one of its orders is in `shops.currency`.

For a shop that has, **a sum across two currencies is a wrong number**, and
adding them is precisely the "blank ≠ zero / header-vs-lines" family of bug this
repo keeps a list of. v1 does not convert them and does not hide them:

- `orderCurrencyMix(shopId, window)` in `packages/analytics` returns the totals
  **grouped by `orders.currency`**.
- The dashboard's revenue figures show the shop-currency total, and, when the
  window contains orders in another currency, a second line naming each — "plus
  €1,240.00 in EUR". No conversion, no single blended number.

**Not done in v1, and named rather than left to be discovered:** the HQ
platform-wide rollups, the partner portal and the CSV export still sum across
currencies. They are correct for every shop today and wrong only for a shop that
has enabled this feature; converting them needs a rate policy, which is its own
decision and is deliberately not smuggled in here.

## Plan gate

`regionalPricing`, **Pro and above**, through `packages/core/src/shop/plans.ts`.
A downgrade stops the currencies being *offered* — `liveCurrencies` returns
nothing — and keeps every typed price, so re-upgrading is one click and nobody
loses their price list. Orders already placed in EUR are untouched: they are
what happened.

## Details that must not be missed

- **Zero- and three-decimal currencies.** `chargeStep` is the only rounding
  rule. A price typed in a currency with three decimals is rounded to what a
  card can settle at the same place every other total is.
- **Blank ≠ zero.** An empty price field means "no price in this currency",
  which makes the currency not live. `0` means free. The parser must not
  conflate them — `parseMoneyToCents` on `""` is not `0`.
- **Compare-at in the same currency.** A `€30` strike-through above a `$25`
  price is the same lie in a smaller font. Stored per currency, validated
  against that currency's price.
- **Coupons.** A percentage coupon is currency-free and works everywhere. A
  fixed-amount coupon is a number in a currency; without one in the order's
  currency it makes the currency not live, and it is never converted.
- **The storefront price filter** (`?min=` / `?max=`) is read in the displayed
  currency and compared against the displayed price, or it filters a €-page
  by $-numbers.
- **`"use cache"` keying.** The catalogue query is keyed on its arguments, so
  the currency is one of them. A currency left out of the key serves one
  visitor's EUR page to the next visitor in dollars.
- **35-locale strings:** the switcher, the settings card, the per-currency
  price fields, the "not offered yet" explanation, the two refusals. Money
  sections are never machine-written.

## Testing

Unit (pure, no database): the country → currency map, including a euro-area
country, the UK, a non-euro EU country and a country that maps to nothing;
`atCurrency` returning null rather than falling back; blank vs `0`; compare-at
below price in the second currency; `chargeStep` applied once; the switcher
cookie ignored for a currency the shop does not offer.

Scenario (money path, which is where the defects are): a shop with a EUR price
sells to a EUR buyer and the order, the totals and the invoice are all EUR; the
same shop sells to a US buyer and the order is USD; a product with no EUR price
makes EUR not live and the Berlin buyer is quoted dollars; a downgrade stops EUR
being offered and the typed prices survive it; a manual-rail EUR order records
EUR; no order is ever written in a currency the shop does not offer.

## Done when

A buyer in Berlin sees euros on the storefront — not for the first time on
Stripe — pays euros on the card rail and on the bank transfer rail alike, and
gets an invoice that says euros; the seller typed every one of those numbers;
and a shop that has priced nothing in euros behaves exactly as it does today.
