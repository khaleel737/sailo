# 04 — Seller Notifications & Preferences

**Priority:** P0 (highest-value gap after security) · **Effort:** M ·
**Depends on:** nothing. 06/07 add more toggles later.

## What

Sailo currently emails only buyers: every function in
`src/lib/email/messages.ts` sends `to: order.customerEmail`; the seller
appears only as `replyTo`. A seller learns about an order by opening the
dashboard. Build (a) seller-facing notification emails and (b) a preferences
panel with per-event toggles. Reference: Stan's Email Notifications tab —
To Me: Calendar Bookings, Orders That Require Fulfillment, Purchase
Confirmations, Lead Captured, Membership Cancellations; To Customers:
Recurring Payments.

## Data model

`notificationPrefs jsonb` on `shops` (migration, production first), default
`{}` meaning **all on** — absence of a key is opt-in, so new event types are
on by default without a backfill. Shape:

```ts
type NotificationPrefs = Partial<{
  orderPlaced: boolean;      // any settled/manual order
  bookingRequested: boolean; // service order with a slot, awaiting confirm
  orderNeedsAction: boolean; // manual-rail payment reported / proof uploaded
  leadCaptured: boolean;     // once spec 07 lands
  membershipCancelled: boolean; // once spec 06 lands
}>;
```

Validate with zod on write; reject unknown keys.

## Send sites (each wrapped in the pref check)

New `src/lib/email/seller-messages.ts` following the exact conventions of
`messages.ts` (markup helpers, `transport.ts`, logs its own failures, never
throws to the caller). Recipient: the **user's** email (auth `user` table),
with `shop.contactEmail` as override when set.

1. **Order placed** — in `createOrderIntent` (`src/lib/actions/orders.ts`) on
   the `settlesAtCheckout` path, inside the existing `after(...)` block
   (never on the request's critical path), and in the Connect webhook
   settlement path (`src/lib/stripe-webhooks/connect.ts`) when
   `checkout.session.completed` marks the order paid. **Exactly one of the two
   fires per order** — same discriminator the buyer email already uses; do not
   double-send on the card rail.
2. **Booking requested** — when a service order with booking claims is
   created; include date/time, buyer contact, and a deep link to
   `/admin/orders/<id>` where the confirm/decline action lives
   (`src/lib/actions/order-admin.ts`).
3. **Order needs action** — when a buyer reports a manual payment or uploads
   proof (`paymentReference` / `paymentProofUrl` writes).

Content rules: subject carries amount + shop currency formatted with
`src/lib/currency.ts`; body links to the order; buyer PII kept minimal
(name + what they bought — not full address in email).

## Preferences UI

Extend the Settings page (a card next to the existing ones in
`src/app/admin/settings/_components/`) or a `notifications` tab in
`settings-nav.tsx` — match Stan's grouping ("To me" / "To customers").
Strings in all 35 `src/i18n/admin/*.ts`.

## Details that must not be missed

- `after()` only runs post-response — the webhook path is not a Next request
  in the same sense; verify `after` is legal there (it is inside route
  handlers) or send inline with a `.catch` that logs.
- Idempotency: webhook retries must not re-send. The idempotency claim in
  `src/lib/stripe-webhooks/idempotency.ts` already makes settlement
  once-only; hang the email off the claimed path exactly like the buyer
  email, and add a source-order test in `orders.test.ts` style pinning that.
- Resend failures must never fail an order — copy the "best effort, logs its
  own failures" pattern documented above `confirmBuyerByEmail`'s call site.
- Email volume: a busy shop is fine (order emails are 1:1) but add a
  per-shop daily ceiling (e.g. 500/day via `rateLimit`) so a bug or an order
  bomb cannot burn the Resend quota; when the ceiling trips, log once.
- Unsubscribe: these are transactional, not marketing — no unsubscribe link
  required, but the prefs URL in the footer is good practice.

## Testing

Scenario: place a manual order → seller email recorded (stub transport the way
`e2e/scenarios/setup.ts` stubs Resend); toggle pref off → no send; card
order → email fires on webhook settle, not at intent creation; webhook
replayed → exactly one email.

## Done when

All three events email the seller subject to prefs, card-rail sends exactly
once on settlement, prefs UI persists, and the scenario pins each behaviour.
