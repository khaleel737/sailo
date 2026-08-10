# 07 — Lead Capture Product & Leads Metric

**Priority:** P1 · **Effort:** M · **Depends on:** 05 (consent),
04 (lead email) · **Blocks:** 14 (audiences)

## What

A free "product" whose checkout is just a form: buyer leaves name + email
(optionally answers questions), optionally receives a file (lead magnet), and
becomes a contact. Reference: Stan's "Collect Emails / Applications" plus the
"Leads" tile in its analytics.

## Data model (migration, production first)

- `products`: new kind `"lead"`. Price is forced to 0 — enforce in the action,
  not the form (blank ≠ zero rule: `priceCents` stays 0, not null).
- `clients`: add `source text` (`purchase | lead | manual`) defaulting
  `purchase` on existing rows, and reuse `marketingConsentAt` from spec 05.
- Optional custom questions: `leadQuestions jsonb` on the product
  (array of `{id, label, required}`), answers in a `leadAnswers jsonb` on the
  client-product join — simplest: a `leads` table (id, shopId, productId,
  clientId, answers jsonb, createdAt) so one contact can submit two magnets.

## Flow

- Storefront: a lead product renders the form instead of the buy panel —
  extend the product page component under `src/app/[handle]/p/[slug]/`.
  No payment method needed, so `withRail` requirements don't apply; the
  submit is a new server action `captureLead`, NOT `createOrderIntent` — no
  order, no invoice, no stock.
- `captureLead`: validate email, `upsertClient` with `source: 'lead'`,
  write the `leads` row, and if the product has files, mint the existing
  download token and email it (`sendDownloadReady` in
  `src/lib/email/messages.ts` already does this — reuse).
- Consent: the form carries the marketing-consent checkbox when
  `askMarketingConsent` (spec 05); a lead magnet download email itself is
  transactional and always allowed.
- Seller notification: `leadCaptured` toggle (spec 04).

## Abuse & rate limits (this endpoint will be farmed)

- `rateLimit` per IP (e.g. 5/min) AND per email+shop (1/hour — resubmits
  update, not duplicate). Throttled = generic success message (do not tell a
  bot it was throttled; do not tell anyone whether the email already existed
  — the same enumeration rule as coupons).
- Email must pass a strict syntax check; consider a disposable-domain
  blocklist as a follow-up, not v1.
- The download token must be single-audience: minted per lead, revocable.

## Analytics

"Leads" becomes a first-class number: count of `clients` rows (or `leads`
rows) in range. Surface on the admin dashboard next to revenue, and as a
per-product count on lead products. The visits pipeline already records
`productId`, so lead-product conversion = leads / product visits — cheap win.

## Details that must not be missed

- Storefront strings in 35 shop dictionaries; admin strings in 35 admin
  dictionaries.
- Lead products are excluded from anything money-shaped: revenue rollups,
  income page, invoice sequence. Grep the rollup queries and exclude
  `kind = 'lead'` explicitly.
- Plan-gate: free plan gets lead capture (it's the top-of-funnel hook — same
  reasoning Stan uses); custom questions can be pro-gated.
- CSV export of clients gains `source`.

## Testing

Scenario: submit lead → client + lead rows, token emailed, no order/invoice
row, revenue unchanged; resubmit same email updates instead of duplicating;
consent recorded only when box ticked; throttled submit returns the same
success shape.

## Done when

A lead product converts a visitor to a contact with optional magnet delivery,
never touches the money ledger, is rate-limited without oracles, and Leads
shows up in the dashboard.
