# 06 — Recurring Memberships (buyer subscriptions)

**Priority:** P1 (largest revenue feature) · **Effort:** XL ·
**Depends on:** 04 (cancellation notices) · **Blocks:** 19 (paid community)

## What

A product a buyer subscribes to — monthly or yearly card billing on the
seller's Stripe account — with automatic access while active. Reference:
Stan's "Recurring Membership — Charge Recurring Subscriptions".

## Current state

Product `kind` is `physical | digital | service`
(`src/db/schema/catalog.ts:52`). Stripe subscriptions exist only for the
*seller's own* Sailo plan (`src/lib/actions/billing.ts`,
`src/lib/stripe-webhooks/platform.ts`). There is no buyer-side recurring
anything. Connect direct charges + the two webhook endpoints
(`src/lib/stripe-webhooks/{connect,platform}.ts` with separate signing
secrets) are live and battle-tested — build on the **connect** side.

## Data model (migrations, production first)

- `products`: new kind `"membership"`, plus `billingInterval text`
  (`month | year`), optional `trialDays integer`.
- New `subscriptions` table: id, shopId, productId, clientId,
  `stripeSubscriptionId` (unique), `stripeCustomerId`, status
  (`active | past_due | canceled | trialing`), `currentPeriodEnd timestamp`,
  `canceledAt`, timestamps. This is the access-control source of truth; the
  Stripe object is the billing source of truth; the webhook reconciles.
- `orders` gains nothing — each successful invoice creates a normal order row
  (`paymentMethod: "card"`, marked as renewal) so Income, exports, and the
  invoice sequence keep telling the truth. Renewal orders skip stock
  and booking logic entirely.

## Flow

1. **Checkout:** membership lines cannot share a basket with other kinds
   (Stripe subscription mode is all-or-nothing) — `resolveLines` refuses a
   mixed basket with a buyer-readable error. `createOrderIntent` branches to
   a `mode: "subscription"` Checkout Session on the connected account
   (Stripe-side price created lazily per product+interval and cached on the
   product row as `stripePriceId`; recreate when priceCents changes, never
   mutate a Price).
2. **Settlement:** on the connect webhook handle
   `customer.subscription.created/updated/deleted` and
   `invoice.paid` / `invoice.payment_failed`. `invoice.paid` upserts the
   subscription row, writes the renewal order + invoice, releases digital
   access. All idempotent via the existing claim in
   `stripe-webhooks/idempotency.ts`; ownership checks via `ownership.ts` —
   an event from account A must never touch shop B (that file is the
   security seam; extend its tests).
3. **Access:** digital files on a membership product resolve through the
   existing download-token path but validate `subscriptions.status = active`
   at download time, not at token mint time — a cancelled member's old link
   must stop working when the period ends (grace: access until
   `currentPeriodEnd`).
4. **Cancellation:** buyer-side via a Stripe **billing-portal session on the
   connected account** linked from the buyer's portal page
   (`sendPortalLinks` already exists); seller-side cancel button on the
   subscription row in admin. `cancel_at_period_end`, not immediate, by
   default.
5. **Dunning:** `invoice.payment_failed` → email buyer (existing message
   style), mark `past_due`; Stripe smart retries do the rest. Seller notice
   on final cancellation (spec 04's `membershipCancelled` toggle).

## Details that must not be missed

- **Platform fee:** direct charges take an application fee today — mirror the
  same fee on subscriptions via `application_fee_percent` on the
  subscription; check how the one-time fee is set in
  `src/lib/orders/card-handoff.ts` and keep the two numbers in one module.
- Currency: interval prices in the shop currency; `toStripeAmount`
  (`src/lib/currency.ts`) already handles 3-decimal currencies.
- Refunds on renewals go through the existing refund path — verify
  `claimRefundAmount` works against renewal orders.
- Coupons: v1 refuses coupons on memberships (Stripe coupons are a separate
  system); say so in the UI rather than silently ignoring.
- Plan-gate: `memberships: boolean` feature flag in `src/lib/plans.ts` —
  business plan (mirror how `affiliates` gates).
- Admin UI: subscriptions list under the product and under the client;
  status chips; MRR number on the dashboard is out of scope v1.
- 35-locale strings for: interval labels, subscribe button, portal links,
  dunning email, cancel confirmations (buyer strings in shop dictionaries,
  seller strings in admin dictionaries).

## Testing

This is money-path code: scenario coverage is mandatory, run against the
local stack (`scripts/scenarios/up.sh`) with `stripe listen` for a live
end-to-end pass (there is precedent in `card-e2e.scenario.ts`). Cover: mixed
basket refused; subscribe → webhook activates → renewal order + invoice
created idempotently under replay; failed invoice → past_due, access retained
until period end; cancel at period end → access expires; ownership: foreign
account event refused.

## Done when

A buyer can subscribe, renew, fail, and cancel with the ledger correct at
every step, replay-safe webhooks, fee parity with one-time charges, and the
scenario suite proving it.
