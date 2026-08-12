# Memberships, end to end

The one test `memberships.scenario.ts` cannot do: a real card on a real
subscription-mode Checkout Session, against a real connected account, renewed
by a real signed webhook.

That suite constructs the events itself and proves the handlers make the right
decisions under replay, out-of-order delivery and a foreign account. It cannot
prove Stripe still *produces* the shapes those handlers read — and this feature
depends on two fields that have already moved once:

- `current_period_end` is on the **subscription item**, not the subscription
  (removed from the parent in `2025-03-31.basil`);
- an invoice names its subscription through **`parent.subscription_details`**,
  not `invoice.subscription`.

Both read as `undefined` if Stripe moves them again, and both fail *silently*:
a member with no period end is either locked out immediately or never, and an
invoice with no subscription is a renewal that quietly writes no order. No unit
test can catch that. This pass is the only thing that can.

## Running it

Same stack as `card-e2e.md` — a test connected account with `charges_enabled`,
the scenario database, and `stripe listen` forwarding **connect** events.

```bash
./scripts/scenarios/up.sh
npx dotenv -e .env.local.test -- npx next dev -p 3100

stripe listen \
  --forward-to         http://localhost:3100/api/stripe/webhook \
  --forward-connect-to http://localhost:3100/api/stripe/connect/webhook
```

Then, in the app: create a product with type **Membership**, a price, and
`month` as the interval. Open its page on the storefront and subscribe with
`4242 4242 4242 4242`.

## Run it automatically first

`memberships-live.scenario.ts` does everything below except driving the hosted
Checkout page, and it does it against a real connected account:

```bash
./scripts/scenarios/up.sh
STRIPE_CONNECT_ACCOUNT=acct_… npx dotenv -e .env.local -- \
  npx vitest run --config vitest.scenarios.mts \
  scripts/scenarios/memberships-live.scenario.ts
```

Skipped without `STRIPE_CONNECT_ACCOUNT`, so the ordinary suite stays offline.
It covers the Price (including that re-pricing mints a *new* one), the
Checkout Session being accepted whole, both moved fields read off real
objects, the application fee actually reaching the platform, a **real renewal
via a Stripe test clock**, replayed invoices writing no second order, and
cancellation grace.

Two things it taught us that reading the docs did not:

- `invoice.application_fee_amount` is **null** on a paid Connect invoice in
  this API version even when the fee has certainly been taken. Assert against
  `/v1/application_fees` on the platform instead — measured: a $30 membership
  at 0.5% produced a 15-cent `fee_…` while the invoice reported nothing.
- `stripe.prices.retrieve(id, params, options)` — the connected-account header
  is the *third* argument. Passing it second returns
  `Received unknown parameter: stripeAccount`.

## What to check by hand, in order

1. **`subscriptions` has one row**, `status = active`, `current_period_end`
   about a month out, `stripe_account_id` equal to the connected account.
   A null period end means the item field moved again.

2. **The signup order settled** rather than a second order appearing:
   `orders` has exactly one row for that subscription, `payment_status = paid`,
   `stripe_invoice_id` set, and one `invoices` row against it.

3. **A renewal writes a second ordinary order.** Do not wait a month —
   Stripe's test clocks advance the billing cycle:

   ```bash
   stripe test_helpers test_clocks create --frozen-time $(date +%s)
   # attach the customer to the clock, then advance it past the period end
   ```

   The renewal must produce a *new* order with the new invoice id, and the
   totals must match `amount_paid` rather than the product's current price.

4. **The fee is on the subscription.** In the Stripe dashboard the invoice's
   application fee should be `platformFeePercent` of the invoice total. A fee of
   zero means `application_fee_percent` was dropped from `subscription_data`,
   and Sailo is running that seller's memberships for free.

5. **Cancel from the member's page** (`/download/<token>` → Manage) and confirm
   Stripe's portal opens *on the connected account* showing only that
   subscription. Cancel there; `cancel_at_period_end` must become true here
   within seconds, and the member must still have access.

6. **A failed card.** Attach `4000 0000 0000 0341` (fails on renewal) and
   advance the clock: `subscriptions.status` becomes `past_due`, the member
   **keeps** access to the end of the paid period, and the dunning email
   arrives with a working `hosted_invoice_url`.

7. **The sweep leaves it alone.** With a trial set, run the hourly sweep
   (`/api/cron/sweep`) while the signup order is still `unpaid`: it must not be
   cancelled. That exemption is keyed on `product_kind = 'membership'`.

## What is already covered without this

`memberships.scenario.ts`, against the real database:

- activation, and idempotency under a repeated event;
- an event from a foreign connected account, refused;
- the signup invoice settling the signup order rather than duplicating it;
- one renewal order per invoice, and one order for the same invoice delivered
  twice (the partial unique index — note it needs its predicate repeated in
  `ON CONFLICT`, or every renewal fails outright);
- a zero-amount invoice writing nothing;
- `past_due` keeping access; cancellation keeping it to the period end;
- a stale `updated` after a `deleted` not resurrecting a cancelled member;
- files refusing to download once the membership lapses.
