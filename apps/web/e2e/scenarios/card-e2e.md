# The card path, end to end

The one test nothing else here can do: a real card, on a real Stripe Checkout
session, against a real connected account, settled by a real signed webhook.

Everything else about settlement is covered by `settlement.scenario.ts`, which
constructs the events itself. That proves the handlers make the right decisions.
It cannot prove Stripe still *produces* the shapes those handlers read — a
renamed field would pass every one of those tests and break in production.

## Running it

You need a test connected account with `charges_enabled`. The app creates
Express accounts, which require a hosted onboarding flow; for a script, create a
Custom account and fill it in over the API — the last thing it asks for is
`individual.phone`, and Stripe's test value is `0000000000`.

```bash
./e2e/scenarios/up.sh
npx dotenv -e .env.local.test -- npx next dev -p 3100

stripe listen \
  --forward-to         http://localhost:3100/api/stripe/webhook \
  --forward-connect-to http://localhost:3100/api/stripe/connect/webhook

STRIPE_CONNECT_ACCOUNT=acct_… npx dotenv -e .env.local.test -- \
  npx vitest run --config vitest.scenarios.mts e2e/scenarios/card-e2e.scenario.ts
```

That writes `/tmp/card-e2e.env` with the order id and the Checkout URL. Open the
URL, pay with `4242 4242 4242 4242`, any future expiry, any CVC.

Two things about driving Stripe's hosted page, both of which cost an hour:

- **`waitUntil: "domcontentloaded"`, never `networkidle`.** Checkout holds
  websockets open, so networkidle never settles and the wait times out on a page
  that is perfectly ready.
- **The card fields do not exist until the Card accordion is clicked.** Before
  that, `#cardNumber` is genuinely absent rather than merely hidden.

## What it proved

Order `4800` cents (2 × $24.00) on `acct_…`, paid with 4242:

- `payment_status = paid`, `status = confirmed`, payment intent recorded
- Stock 5 → 3
- Invoice `INV-0001` issued **once**, and the buyer redirected to it
- `checkout.session.completed` claimed exactly once in `stripe_events`
- The confirmation email failed — Resend refuses `example.com` in test mode —
  was logged, swallowed, and did not stop the order settling, which is the
  designed behaviour and had never been observed under real conditions before.
