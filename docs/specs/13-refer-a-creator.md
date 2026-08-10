# 13 — Refer-a-Creator Program

**Priority:** P2 · **Effort:** M–L · **Depends on:** nothing ·
**Distinct from:** product affiliates (`src/app/admin/affiliates/`), which
pay commission on a *shop's products*. This pays a *creator* for bringing
another *creator* to Sailo.

## What

Every seller gets a referral link; when a referred signup converts to a paid
plan, the referrer earns 20% of that subscription revenue recurring.
Reference: Stan's "Stan Referral Link — receive 20% of their Stan
Subscription fee each month", surfaced both as a product card and a banner.

## Data model (migrations, production first)

- `users` (or `shops`): `referralCode text unique` — short, generated once
  (reuse the token-generation idiom the affiliate/partner links use).
- New `creatorReferrals`: id, referrerShopId, referredUserId (unique — one
  referrer per account, first-touch wins), `attributedAt`, `convertedAt`
  (nullable until first paid invoice).
- New `referralEarnings` ledger: id, referralId, `stripeInvoiceId` (unique —
  idempotency against webhook replay), amountCents, currency, createdAt,
  `paidOutAt` (nullable). **Append-only; never update amounts in place** —
  the money rule everywhere else in this repo.

## Flow

1. Landing: `sailo.store/r/<code>` → sets a 90-day cookie
   (`sailo_ref=<code>`, httpOnly not needed, SameSite=Lax) → redirects to
   signup. The cookie is read once at account creation and written to
   `creatorReferrals`; the cookie never decides anything after that.
2. Conversion: in the **platform** webhook
   (`src/lib/stripe-webhooks/platform.ts`), on `invoice.paid` for a
   subscription, look up the payer's referral row; if present, append an
   earnings row for 20% of the invoice amount. Idempotent on
   `stripeInvoiceId` (unique constraint is the guard, not a read-then-write).
   Refunded platform invoices append a negative row.
3. Payout: v1 is **manual** — an HQ page (`src/app/hq/`) lists unpaid
   balances per referrer with a "mark paid" action stamping `paidOutAt`.
   Automated Stripe transfers are a follow-up; do not block on them.
4. Seller surface: a card in the admin (dashboard or settings) showing the
   link, referred count, converted count, lifetime + unpaid earnings.

## Anti-abuse (the whole game for referral programs)

- Self-referral: refuse when the referred email/user equals the referrer, and
  when the new subscription's card fingerprint matches the referrer's
  (Stripe exposes `payment_method_details.card.fingerprint` — store a hash on
  the platform customer at subscribe time for this check).
- Attribution is first-touch and immutable — a second referral cookie never
  overwrites an existing row.
- Earnings accrue only from real paid invoices (webhook), never from
  client-side claims; trials/`$0` invoices accrue nothing.
- Cap nothing silently: if a decision caps earnings (e.g. 12 months), it goes
  in the UI copy, not just the code.

## Details that must not be missed

- The `/r/<code>` route is public and unauthenticated: rate-limit it, treat
  unknown codes as a plain redirect to the homepage (no oracle about which
  codes exist).
- 35-locale admin strings; the share card includes copy-to-clipboard.
- Legal: referral terms line + the payout threshold (e.g. $25 minimum) stated
  on the card.

## Testing

Scenario: signup with cookie → referral row; paid platform invoice webhook →
earnings row exactly once under replay; self-referral refused; refund appends
negative; HQ mark-paid stamps and survives double-click (idempotent).

## Done when

Link → signup → paid conversion produces an auditable, replay-safe 20%
ledger with self-referral closed and a manual payout path in HQ.
