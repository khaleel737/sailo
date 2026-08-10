# 09 — Per-Shop Marketing Pixels

**Priority:** P2 · **Effort:** M · **Depends on:** a storefront consent
mechanism (see below — the hard half of this spec)

## What

Sellers paste their Facebook Pixel ID, TikTok Pixel ID, Google Analytics
measurement ID, and Pinterest Tag ID; the storefront fires page-view and
purchase events into *their* accounts. Reference: Stan's Profile → Analytics
block (gated to Creator Pro; gate ours `pro`).

## Data model (migration, production first)

On `shops`: `fbPixelId`, `tiktokPixelId`, `gaMeasurementId`,
`pinterestTagId` — all nullable text. **Validate at write with strict
per-vendor regexes** (`^\d{5,20}$` for FB, `^G-[A-Z0-9]{4,20}$` for GA4,
`^[A-Z0-9]{10,30}$` TikTok, `^\d{10,20}$` Pinterest). These IDs end up inside
`<script>` — the regex is the XSS boundary; reject anything else at the
server action, not the form.

## The two hard constraints

1. **CSP.** The storefront ships a strict Content-Security-Policy (see the
   middleware/headers config — the dev `unsafe-eval` handling lives there).
   Each vendor needs `script-src` + `connect-src` (+ `img-src` for pixel
   fallbacks) additions: `connect.facebook.net`, `analytics.tiktok.com`,
   `www.googletagmanager.com` / `www.google-analytics.com`,
   `s.pinimg.com` / `ct.pinterest.com`. Add them **only on `[handle]` routes
   and only when that shop has the ID set** — a per-request CSP, not a global
   loosening. Verify with the browser console on a real storefront; CSP
   violations are silent in tests.
2. **Consent.** Sailo's cookie banner covers Sailo's own GA on marketing
   pages — storefronts have none. Marketing pixels on EU visitors need
   consent. Ship a lightweight storefront consent prompt that appears only
   when the shop has ≥1 pixel configured; store the answer in
   localStorage per shop (mirror `src/lib/consent.ts`'s pattern — the choice
   deliberately lives in localStorage, and label it that way; see the
   cookie-consent banner's history). No consent → no vendor script loads at
   all (not "loads but doesn't track").

## Events

v1: `PageView` on storefront + product pages; `Purchase` with value/currency
on the thank-you page for card orders (the redirect return) and manual-rail
confirmation view. Do NOT fire server-side conversion APIs in v1.

## Details that must not be missed

- Scripts load with `next/script` `strategy="afterInteractive"`, and only in
  the `[handle]` layout — never on admin, HQ, or Sailo marketing routes.
- The purchase event needs the order total; pass it through the confirmation
  page's existing props, never re-fetch client-side with the order id
  (enumeration surface).
- Pixel IDs render into a `<script>` built from constants + the validated ID
  — never interpolate any other shop field into script text.
- `"use cache"` pages: the pixel snippet depends on shop columns already in
  the cached payload; bump `cacheTag(shopTag(shopId))` invalidation happens
  on settings write like every other shop edit — confirm the settings action
  calls `revalidateTag`.
- Settings UI in the analytics/settings card, pro-gated with the upgrade
  modal; strings in 35 admin locales; the consent prompt strings in 35 shop
  dictionaries.

## Testing

Unit: every regex rejects `"><script>` shapes and accepts real IDs. E2E
(Playwright): with a pixel set and consent granted the script tag exists;
without consent it does not; CSP header contains vendor hosts only on that
storefront.

## Done when

All four vendors fire page-view + purchase behind consent, CSP stays strict
everywhere else, and injection via the ID fields is provably closed.
