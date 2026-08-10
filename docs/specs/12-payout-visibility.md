# 12 — Payout Visibility (Stripe Connect balance)

**Priority:** P2 · **Effort:** S · **Depends on:** nothing

## What

Stan holds funds and makes sellers "Cash Out" manually. Sailo's Connect
direct charges pay sellers automatically — strictly better, but invisible.
Surface it: available balance, pending balance, recent payouts, and account
health on the admin Payments page (`src/app/admin/payments/`, next to the
existing `stripe-card.tsx`).

## Build

- Server-side reads with the platform key against the connected account
  (`stripeAccountId` on the shop — see how `check-connect-live.ts` and the
  connect webhook resolve it):
  - `stripe.balance.retrieve({ stripeAccount })` → available + pending per
    currency.
  - `stripe.payouts.list({ limit: 10 }, { stripeAccount })` → date, amount,
    status, arrival date.
  - `stripe.accounts.retrieve` → `payouts_enabled`,
    `requirements.currently_due`.
- **Requirements banner:** when `currently_due` is non-empty or
  `payouts_enabled` is false, show a warning with a deep link to the Stripe
  Express dashboard login link (`stripe.accounts.createLoginLink`) — this is
  the single most support-ticket-saving element on the page.
- Cache the three reads for ~5 minutes per shop (Redis via `withRedis`, key
  `payouts:<shopId>`; fall back to live reads when Redis is cold — the
  accelerator-not-source-of-truth rule at the top of `src/lib/redis.ts`).

## Details that must not be missed

- No Connect account yet → the page keeps its current "connect Stripe" state;
  this card renders only when `stripeAccountId` exists.
- Currency: balances arrive per-currency; render all of them, formatted by
  `src/lib/currency.ts` (a UK shop refunded in EUR once has two rows — show
  both, don't sum across currencies).
- Rate limit the server action/route that refreshes (10/min per shop) — the
  Stripe API has its own limits and this page will be F5'd on payday.
- Failures degrade to "couldn't reach Stripe, try again" — never a broken
  payments page (the seller's rails must stay editable regardless).
- Strings in 35 admin locales, including payout status words
  (paid / pending / in transit / failed).

## Testing

Unit: currency grouping + formatting. Manual live pass against the test-mode
connected accounts (9 exist) with `stripe listen` running; assert the
requirements banner shape by pointing at an account with `currently_due`
non-empty (create one with `stripe accounts create` in test mode).

## Done when

A connected seller sees balance, last payouts, and a requirements warning
with a working Express login link, cached and rate-limited.
