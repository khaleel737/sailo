# 28 — Shipping Zones (where a shop will actually post to)

**Priority:** P2 · **Effort:** M · **Depends on:** nothing

## What

A shop says which countries each shipping rate covers. The checkout asks the
buyer for a country from a real list, offers only the rates that reach it, and
says so plainly when none of them do. The server refuses an order for a
country the chosen rate does not serve.

Today `deliveryMethods` has no geography at all — every rate is offered to
everyone on earth — and `country` at checkout is a free-text input that is not
even required. A seller who posts only within Croatia has no way to say so and
finds out at packing time; and the value they get is whatever the buyer typed
("Hrvatska", "HR", "croatia", blank), which is unfilterable and unenforceable.

This is the smallest change that makes "EU only" and "Croatia only" true
statements rather than hopes.

## Data model (migration to production first)

`drizzle/0019_shipping_zones.sql`:

- `delivery_methods.countries text[] NOT NULL DEFAULT '{}'` — ISO 3166-1
  alpha-2, uppercase. **Empty means anywhere**, which is what every existing
  row means today, so the default is a no-op backfill and no row changes
  behaviour on deploy.
- No new table, and deliberately no `zones` entity. A zone that is not
  attached to a rate has no meaning — the rate *is* the zone, and the case
  that actually matters commercially (Croatia €3, EU €9, nowhere else) is two
  rows, not a join.

Codes are stored expanded, never as a group token: "EU" is written as its 27
members. A group is a way to fill the box, not a thing the database knows —
otherwise the day a country joins or leaves the EU silently rewrites what
every historic rate promised.

Only `shipping` carries a zone. Collection is a pickup at one address; a zone
on it would be a rule about where the buyer lives, which is not a thing the
seller is entitled to care about. `saveDeliveryMethod` writes `{}` for
collection whatever the form says.

## Files

| File | Change |
|---|---|
| `src/lib/countries.ts` | **new** — the alpha-2 list, the group presets, `countryName`/`countryFlag` (moved off `analytics.ts`), `normalizeCountry` |
| `src/lib/delivery.ts` | `shipsTo(method, country)`, `parseCountries` |
| `src/db/schema/commerce.ts` | the column |
| `src/lib/actions/delivery.ts` | parse and validate the country list on save |
| `src/lib/orders/delivery.ts` | `resolveDelivery` takes the country, gains `"unserviceable"` |
| `src/lib/orders/resolve-intent.ts` | passes `input.country`, refuses `"unserviceable"` |
| `src/lib/actions/order-preview.ts` | passes the country; treats unserviceable as "no fee", never as an error |
| `src/lib/queries/checkout.ts` | `countries` on the checkout delivery option |
| `src/app/[handle]/_components/cart/checkout.types.ts` | `CheckoutDelivery.countries` |
| `src/app/[handle]/_components/cart/checkout-panel.tsx` | the country select, the filtering, the refusal notice |
| `src/app/[handle]/_components/cart/use-checkout-quote.ts` | country through to the preview |
| `src/app/admin/delivery/_components/country-picker.tsx` | **new** — the zone editor |
| `src/app/admin/delivery/_components/delivery-rate-form.tsx` | mounts it, shipping only |
| `src/app/admin/delivery/page.tsx` | the zone on the summary row |
| `src/lib/orders/buyer.ts` | store the country as a code when it is one |
| `src/lib/utils.ts` | `formatAddress` renders `HR` as `Croatia` |

## The rule, in one function

```
shipsTo(method, country):
  collection            -> true   (nothing is being posted)
  countries is empty    -> true   (anywhere)
  country is missing    -> false  (a restricted rate cannot be checked blind)
  otherwise             -> countries includes normalize(country)
```

Everything else reads this. The bug shape this codebase keeps finding is a
guard applied at one sink and not at its twin — the checkout panel, the
preview and the order all ask the same function, and the two server callers
reach it through the same `resolveDelivery`.

## resolveDelivery, precisely

The three "no delivery" answers are not the same answer and must not collapse:

- **`undefined` — nothing to price.** Either the basket doesn't travel, or the
  shop has configured no delivery options at all. The second is existing
  behaviour and stays: such a shop takes physical orders with no delivery
  choice and no fee. A zone must never turn that into a refusal.
- **`"unavailable"` — the requested rate isn't one of this shop's usable
  ones.** Unchanged.
- **`"unserviceable"` — new.** The shop *has* rates and none of them reaches
  this country. This is the only new refusal, and it exists because falling
  back to `available[0]` (what the current code does for a stale id) would
  quietly ship an order to a country the seller had just excluded.

## Checkout

The country moves **out of the address fieldset and above the delivery
options**, as its own control, because it now gates them: the buyer answers
"where is this going?" before "how would you like to receive it?". One
control, one render site — a country input in two places is the same twin-sink
bug in the UI.

- It is a `<select>`. Names come from `Intl.DisplayNames` in the buyer's
  locale, so 35 dictionaries gain four strings rather than 250 × 35 country
  names.
- **What's in the list.** If every shipping rate the shop offers is
  restricted, the list holds only the union of their countries — a
  Croatia-only shop shows a dropdown with Croatia in it and nothing else,
  which is the whole feature in one glance. If any rate is unrestricted, the
  list is every country.
- **When it is required.** Only when a restriction depends on it. An
  unrestricted shop keeps today's behaviour, where country is optional — the
  existing reasoning for leaving region/postcode/country optional was that a
  required field an honest buyer cannot fill is worse than a blank one, and
  nothing here overturns it.
- Choosing a country the rates don't reach shows the shop's refusal in the
  buyer's language and disables the submit — unless a collection option
  exists, which is unaffected and stays selectable.
- The chosen rate is re-picked when it stops being available, the same way the
  payment rail is already re-read through what is still on offer rather than
  trusted.

## Details that must not be missed

- **Existing orders keep free-text countries.** `formatAddress` expands a
  two-letter value through `Intl.DisplayNames` and passes anything else
  through untouched, so "Hrvatska" typed last month still reads as
  "Hrvatska" and `HR` saved tomorrow reads as "Croatia". No backfill: guessing
  what a buyer meant and writing it down as fact is worse than a string.
- **`countryName` already exists** in `analytics.ts` and is the right
  function. It moves to `countries.ts` rather than being written twice; its
  two callers (`traffic-panel.tsx`, `analytics.test.ts`) move with it.
- **The checkout options are cached** (`getCheckoutOptions`, `"use cache"` +
  `cacheLife("max")` + `cacheTag(shopTag(shopId))`). `saveDeliveryMethod`
  already calls `revalidateShop`, so a zone edit drops the storefront's copy —
  verified, not assumed (`revalidateTag(shopTag(id), "max")` in `lib/cache.ts`).
- **`countries` is optional on the *browser's* copy**, though the column is
  `NOT NULL`. The first render after this deploys can be served a cached
  payload written by the previous build, with no `countries` on it. `shipsTo`
  and `shippableCountries` read absent as "anywhere", the same as empty —
  anything else throws on `undefined.length` and takes every checkout panel
  down at once, for the duration of a cache entry that lives for ever.
- **A zone with nothing in it is rejected at save**, not stored. "Selected
  countries" with none selected would be indistinguishable from "anywhere" in
  the column, and would mean the opposite.
- **Empty ≠ zero, again.** `countries: []` is "anywhere", not "nowhere". Every
  read site says so out loud.
- **No plan gate.** This is table stakes for selling a physical object, not an
  upsell.
- **No per-country tax.** `shops.taxRateBp` is one flat rate by design and
  stays one. Zones will *feel* like they imply VAT-by-destination; they do
  not, and pretending otherwise turns this into a tax engine.
- 35 storefront strings (typed complete — `en.ts` breaks the build until they
  land) and 35 admin ones.

## Testing

Unit — `src/lib/countries.test.ts`, `src/lib/delivery.test.ts`:

- `shipsTo`: empty zone accepts everything including a missing country; a
  restricted zone refuses a missing country; case and whitespace normalise;
  collection ignores the zone entirely.
- Group presets expand to the right members and contain no duplicates or
  codes outside the ISO list.
- `formatAddress` expands `HR`, passes "Hrvatska" through, and still drops
  blanks.

Server — `resolveDelivery`:

- shop with no options at all → `undefined` (the regression that would break
  every existing shop).
- shop with options, none serving `US` → `"unserviceable"`.
- requested id that serves the country → that row; one that doesn't →
  refused, **not** silently replaced with `available[0]`.

Scenario: a Croatia-only shop refuses a `DE` order end to end, with nothing
written — no stock taken, no coupon spent.

## Done when

A seller sets "Standard — Croatia only" and "Europe — EU", a Croatian buyer
sees both, a German buyer sees only the second, an American buyer is told the
shop doesn't post there and cannot submit, and an order posted directly with
`country: "US"` is refused by the server.
