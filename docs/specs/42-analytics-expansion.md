# 42 — Analytics expansion: pixels, tiles, share links, link vocabulary

**Priority:** P2 · **Effort:** M · **Depends on:** 32 (session tiles), 30
(automation-run tiles) · **Blocks:** nothing

## What

Four small gaps in a good analytics stack, batched because each alone is too
small for a release. Reference: Easytools Store → Analytics and Store settings →
Analytics, §`setting-up-analytics` onward.

## Where Sailo stands

Strong: a dashboard, product performance, outbound clicks (`clicks` table with a
beacon), a daily rollup, plan-clamped date ranges, and — measurably better than
theirs — pixels that are **validated, consent-gated and CSP-scoped** (spec 09,
which also fixed `setLocale` purging the prerendered tree).

Missing, precisely: three pixel integrations, four metric tiles, a shareable
stat, and the checkout-link parameter vocabulary theirs documents at length.

## 1. Three more pixels

`shops` has `gtmContainerId`, `metaPixelId`, `tiktokPixelId`. Add
`googleAdsId`, `googleAdsConversionId`, `linkedInPartnerId`,
`pinterestTagId` — theirs also lists DataFast, which is one vendor's product and
is **refused**: a named third-party analytics vendor in our settings is an
endorsement and a support surface.

Each one must go through spec 09's three gates or it does not ship:

1. **Format validation** on the id (`AW-\d+`, a numeric LinkedIn partner id,
   a numeric Pinterest tag id) — an unvalidated id is a script-injection point
   in a `<script>` src.
2. **Consent gate** — nothing loads before consent, and the existing
   cookie-consent path decides.
3. **Scoped CSP** — each vendor's domains added to `script-src`/`img-src`
   **only when that pixel is configured**, never unconditionally. A blanket
   allowlist undoes spec 09.

Their "block checkout until cookie consent" toggle is worth copying, with their
own recommendation intact: default **off**, because blocking the cart to
improve analytics completeness trades revenue for a number.

## 2. Four metric tiles

Theirs shows 13 tiles; Sailo shows a subset. Add the four that are now
computable and currently absent:

| Tile | Source |
|---|---|
| Checkout sessions | spec 32's `checkout_sessions` |
| Recovered revenue | spec 32, `status = 'recovered'` |
| Free products redeemed | spec 07's `lead` kind |
| Automation runs | spec 30's `automation_runs` |

Conversion, AOV, revenue per customer and partner revenue already exist or are
one query away from `visit_daily` and `orders`. **Do not add a tile whose source
has not shipped** — an always-zero tile reads as a broken product, which is why
these are sequenced after 30, 32 and 07.

## 3. Share links

Theirs puts a **Share** control on every tile. A seller sharing a revenue chart
with a partner or a landlord is a real use, and it is also the most dangerous
feature in this spec: a public URL rendering a shop's revenue.

Rules, and none of them are negotiable:

- `analytics_shares(id, shop_id, metric text, range text, token_hash text,
  expires_at, revoked_at, created_at, created_by_email)`, hashed token, and
  **an expiry that is required** — default 30 days, maximum 90. A link that
  never expires is a permanent public revenue feed.
- **One metric and one fixed range per token.** Not a dashboard. The token
  cannot be edited into a different metric or a wider window by changing a
  query parameter, because neither is in the URL.
- **Aggregates only.** No order rows, no buyer names, no product-level
  breakdown unless the metric *is* product performance. No CSV.
- Rate-limited per token, `noindex`, its own minimal CSP, no auth cookie read.
- Listed and revocable in settings, with created-by and last-viewed.
- Plan gate: Business.

## 4. Checkout link vocabulary

Theirs documents a full parameter language: preselect a variant, prefill buyer
fields, preselect a payment method, open with a promo-code field, set a custom
price, embed an affiliate code, generate a QR. Sailo has order QR codes and
door passes but no documented link vocabulary.

Ship a **small, closed** set and document it at `/docs`:

```
?variant=<id>        preselect a variant
?coupon=<code>       prefill the coupon field  (never auto-apply — see below)
?qty=<n>             clamped to maxPerOrder and stock
?ref=<affiliateCode> existing affiliate attribution
?name= ?email=       prefill only
```

- **`?coupon=` prefills, it does not apply.** Auto-applying from a URL makes
  every coupon guess free and turns the storefront into a discount oracle — the
  enumeration finding (`PRODUCTION-PLAN.md`) put a 10-per-5-minutes ceiling on
  coupon guesses precisely because a working code is a bearer token. Prefilling
  still charges the ceiling when submitted.
- **No `?price=`.** Theirs has a custom-price link. Sailo will not: a price in a
  URL is a price from the browser, and "the server re-prices everything" is the
  invariant the whole checkout rests on. Pay-what-you-want (spec 43) is the
  supported way to let a buyer choose an amount, with a server-side floor.
- Prefilled `email`/`name` are **untrusted display values** — escaped, never
  treated as consent, never used to look a client up.
- Unknown parameters are ignored silently, and no parameter may widen anything
  (a `qty` above `maxPerOrder` clamps and **says so** — rule 8, no silent caps).

## Details that must not be missed

- **The dashboard reads a replica.** `PRODUCTION-PLAN.md` records HQ aggregates
  being moved off the primary; every new tile query goes to the replica too.
- **Plan-clamped ranges** already exist and every new tile must respect them —
  a tile that quietly renders 12 months on a Free plan undoes the clamp.
- **Consent and pixels:** confirm the new pixels are absent from the DOM
  entirely before consent, not merely inert. A `<script>` present but unfired
  is still a third-party connection.
- 35-locale strings: four tile labels, four pixel field labels, the share dialog,
  the expiry copy.

## Testing

Unit: id validators for all four new pixels including hostile inputs
(`"><script>`, a URL, a very long numeric); the CSP builder emitting a vendor's
domain only when configured; share-token scope (metric and range are not
overridable); `qty` clamping; `?coupon=` prefill producing no lookup.

Scenario: a share link renders one metric and refuses a changed metric
parameter; an expired and a revoked token both refuse; a pixel is absent from
the response before consent and present after; a coupon in a URL is not applied
and the guess ceiling still charges on submit; each new tile matches a
hand-computed figure over a seeded window.

## Done when

Four more pixels load only after consent under a scoped CSP, four new tiles show
real numbers from shipped sources, a share link exposes exactly one aggregate for
a bounded time and can be revoked, and no URL parameter can set a price.
