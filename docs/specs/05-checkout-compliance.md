# 05 — Checkout Compliance Toggles (Terms & Marketing Consent)

**Priority:** P1 · **Effort:** S–M · **Depends on:** nothing ·
**Blocks:** 14 (broadcasts need lawful consent)

## What

Two per-shop switches, mirroring Stan's Payments settings:

1. **Enable Terms & Conditions** — checkout shows a required "I agree to the
   terms" checkbox linking the seller's terms; the sale cannot complete
   without it.
2. **Enable Marketing Consent (GDPR)** — checkout shows an *optional*
   "email me updates and offers" checkbox; only opted-in buyers may ever
   receive marketing email.

## Data model (one migration, production first)

- `shops`: `requireTerms boolean default false`, `termsUrl text` (nullable —
  if null, fall back to a generic terms block; validate it is https and not
  an internal host, reusing the SSRF guard used for product file URLs),
  `askMarketingConsent boolean default false`.
- `orders`: `termsAcceptedAt timestamp` (nullable) — proof of agreement,
  recorded server-side at order creation, never trusted from a resubmitted
  flag later.
- `clients`: `marketingConsentAt timestamp` (nullable). Consent is a fact
  with a date, not a boolean — audits ask *when*.

## Behaviour

- `createOrderIntent` (`src/lib/actions/orders.ts`) takes
  `acceptedTerms?: boolean`, `marketingOptIn?: boolean`. **The server
  enforces:** when `shop.requireTerms` and `!acceptedTerms`, refuse with its
  own error message — a hand-rolled POST must not bypass the checkbox. The
  same rule goes through `previewOrder` untouched (quotes don't need terms).
- `upsertClient` merge rule: consent can be *granted* by a later order but
  never *revoked* by omission — a buyer who opted in last month and left the
  box empty today keeps their consent (they didn't withdraw; they skipped an
  optional box). Withdrawal is its own future path (unsubscribe, spec 14).
- The checkout panel (`src/app/[handle]/_components/cart/checkout-panel.tsx`)
  renders both checkboxes above the pay button; terms checkbox is
  `required`, consent is not and defaults **unchecked** (pre-checked consent
  is invalid under GDPR).
- Card rail: the checkboxes render on Sailo's panel *before* the Stripe
  redirect, so `termsAcceptedAt` is written on the order at intent time —
  no Stripe Checkout customisation needed.

## Details that must not be missed

- Storefront strings are buyer-facing: keys in all 35
  `src/i18n/dictionaries/*.ts` (checkout section), not the admin dictionaries.
- The terms link opens in a new tab and must not lose the basket.
- Exports (`src/lib/exporters.ts`, clients CSV) gain a `marketing_consent_at`
  column — the list a seller downloads must carry the proof.
- Settings UI: add to the payments-adjacent card in
  `src/app/admin/settings/_components/`; plan-gate: none (compliance is not
  an upsell).
- `orders.test.ts`-style source assertion: the server-side terms check lives
  before any write (stock reservation) — refusing after reserving would leak
  a reservation cycle.

## Testing

Scenario: shop with `requireTerms` on → order without the flag is refused,
with it succeeds and `termsAcceptedAt` is set; consent granted then absent on
a second order stays granted; consent never set stays null; CSV shows the
timestamp.

## Done when

Server-enforced terms, timestamped consent with grant-only merge, both
checkboxes localised in 35 locales, export updated, scenarios green.
