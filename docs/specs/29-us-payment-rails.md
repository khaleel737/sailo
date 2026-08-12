# 29 — US payments: Stripe capabilities first, two links after

**Priority:** P0 for the US push · **Effort:** S–M · **Depends on:** nothing

## Status — built, with two things only a human can finish

**Shipped in code.** `link_payments`, `cashapp_payments` and
`us_bank_account_ach_payments` requested on every connected account
(`WALLET_CAPABILITIES` in `connect.ts`), with an idempotent backfill that runs
whenever an existing seller reopens the payments screen. Venmo and PayPal.Me
ship as manual rails, translated into all 35 locales, with a pay button on the
confirmation step and the reference box unchanged. The card rail's description
now names the wallets behind it, so a buyer sees "Card, Apple Pay, Google Pay,
Link and Cash App Pay" before they click rather than discovering it on Stripe's
page. Verified: `tsc` clean, 1,815 unit tests, 9 new scenarios against a real
Postgres, build, `oxlint`, `knip`.

**Also shipped: a currency gate on the rails that need one.**
`PaymentMethodDef.availability` declares which currencies a rail can settle;
`isRailAvailable` is checked inside `isRailUsable`, so the storefront and
`createOrderIntent` both enforce it, and the admin card shows the rail
explained rather than hidden. Venmo is USD-only. PayPal carries its 22 usable
codes — PayPal documents 25 and three are deliberately excluded: **HUF and
TWD** because PayPal takes no decimals on either while `currency.ts` stores
both at two, and **RUB** because PayPal suspended Russian operations in 2022.
The three-decimal Gulf currencies are on none of PayPal's lists at all.

## Why currency, and not a region picker

The obvious next step looks like the shipping-zones model: let the seller
choose a region and show the payments for it. That is the wrong axis here, for
three reasons worth writing down before somebody builds it.

**Two different countries are in play.** The *seller's* country decides which
rails they can hold an account for; the *buyer's* country decides what is
useful at checkout. Shipping zones are about the buyer. Payment eligibility is
mostly about the seller. A single "region" control would conflate them and be
wrong for one of the two every time.

**Stripe already does the buyer half, better.** Card, Link, Cash App Pay, ACH
and the wallets are resolved by Stripe at runtime from the buyer's country and
device. A hand-maintained region→method map beside it would drift from Stripe's
within a release and start hiding methods that work.

**Currency is the predicate that actually protects the buyer.** Country decides
whether a seller *may* hold a Venmo business profile — theirs to know, and not
something we can verify. Currency decides whether the number we put in the link
is the number the buyer is asked for, and that one is ours to get right: a US
seller pricing in euros generates `venmo.com/…?amount=45.50` and Venmo reads
dollars. So the gate sits where the harm is.

`shops` has a `currency` and no `country`, which fits. When a rail arrives whose
constraint genuinely *is* country — Pix, UPI, M-Pesa — `availability` gains a
`countries` field beside `currencies`, `shops.country` earns its migration, and
`countries.ts` (which already has `COUNTRY_CODES`, `EU`, `EEA` and
`COUNTRY_GROUPS`) supplies the picker. The declarative shape is there so that
change is additive.

**Two things left, and neither is code:**

1. **Turn the three methods on in the Stripe Dashboard**, default-on for
   connected accounts. A requested capability that the platform has not enabled
   stays `inactive` and never reaches a checkout. Nothing in the app can do
   this.
2. **Confirm Cash App Pay is obtainable at all.** It requires a **US business
   location**, and Sailo's platform account is not US. On direct charges the
   connected account is the business of record, so a US seller *should* qualify
   — but Stripe's Connect doc also says to set the capability active on the
   platform account. Read the capability status in the Dashboard and ask Stripe
   support to confirm the direct-charge case. If the answer is no, the request
   is harmless (it stays `inactive`) and Link and ACH are unaffected.

## What

Make a US seller recognise their own business on the payments screen. Almost
all of it is **Stripe capabilities on the Connect integration that already
exists** — not new rails. Two things Stripe genuinely cannot serve stay as
manual links.

An earlier draft of this spec proposed building Venmo, Cash App and Zelle as
hand-rolled manual rails. That was wrong about the middle one and wrong about
the scope: Stripe already carries six US payment methods Sailo isn't asking for,
and the checkout code needs no change to accept any of them.

## Why no checkout code changes

`createCheckoutSession` in `src/lib/connect.ts` **does not pin
`payment_method_types`** — the same deliberate choice `billing-checkout.ts:84`
documents for the billing session. Stripe resolves eligible methods at runtime
from the connected account's active capabilities and the platform's Dashboard
settings.

So every method below is a capability request plus a Dashboard toggle. The
checkout panel, the order model, the webhook, the invoice sequence and
`platformFeeCents` are all untouched.

## What Stripe gives a US seller on direct charges

Connected accounts are `type: "express"` (`connect.ts:99`), so capabilities are
the platform's to request — the seller cannot enable them from a Dashboard they
do not have.

| Method | Capability | Express | Notes |
|---|---|---|---|
| Card | `card_payments` | **live** | — |
| Apple Pay | via `card_payments` | **live** | Already appears in Checkout |
| Google Pay | via `card_payments` | **live** | Already appears in Checkout |
| Link | `link_payments` | GA, all business types | One-click for anyone who has used Link anywhere. Cheapest conversion win here |
| Cash App Pay | `cashapp_payments` | Per the Connect doc | USD, US buyers **excluding US territories**. Absent from the capability table — the table lags; the dedicated Connect section is explicit |
| ACH Direct Debit | `us_bank_account_ach_payments` | GA, all business types | Low fee, good on larger orders |
| Klarna | `klarna_payments` | GA | Needs MCC — see below |
| Affirm | `affirm_payments` | GA | Needs MCC |
| Afterpay / Clearpay | `afterpay_clearpay_payments` | GA | Needs MCC |
| Amazon Pay | `amazon_pay_payments` | **Verify** | US + USD supported, but listed only in the full-Dashboard table, not the Express one |
| Pay by Bank | `pay_by_bank_payments` | **No** — "Generally available: No" for Express | Don't request it |

Six new methods for one capability list and some Dashboard toggles.

## PayPal cannot happen, and it is worth knowing exactly why

Three independent blockers. Any one of them is fatal.

1. **The US is not on Stripe's PayPal supported-business-location list.** That
   list is AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, IE, IT, LV, LI, LT,
   LU, MT, NL, NO, PL, PT, RO, SK, SI, ES, SE, CH, GB. Europe and the UK. A US
   seller cannot accept PayPal through Stripe at any charge type.
2. **PayPal does not support direct charges or `on_behalf_of` on Connect.**
   Destination charges and separate charges and transfers only.
3. **Stripe restricts PayPal to marketplaces**, and says so by name: *"PayPal
   isn't available for platforms that onboard other businesses and enable them
   to accept payments directly, such as Shopify or Squarespace."* That is
   precisely Sailo's shape.

Routing around blocker 2 means switching to **destination charges**, which makes
**Sailo the merchant of record**: in the flow of funds, liable for disputes and
connected-account negative balances, and carrying sales-tax and consumer-
protection obligations. The README's central claim — *"the money goes to them
and never sits with us"*, *"no merchant-of-record liability"* — stops being
true, and it still would not clear blockers 1 or 3.

**Venmo** has no Stripe support of any kind. It is PayPal-owned and reachable
only through Braintree / PayPal Commerce Platform — a second processor with its
own per-seller onboarding, webhooks, reconciliation and disputes, US-business-
entities-only. A quarter of work for one rail, doubling the money path this
codebase is most careful about.

So those two, and only those two, stay as manual links.

## The three things that are actually work

**1. MCC is not set, and three of these need it.**

`accounts.create` (`connect.ts:98`) sets `business_profile` with a name and url
and **no `mcc`**. Stripe's Connect doc, on Affirm and Afterpay: *"Stripe and
[the provider] rely on merchant category codes to determine eligibility of the
connected accounts... Make sure that you set correct MCCs for your connected
accounts that use the Express Dashboard."* Cash App Pay carries its own long
prohibited-and-restricted MCC list.

So a shop→MCC map is needed: bakery `5462`, florist `5992`, beauty `7230`,
apparel `5651`, gifts/novelty `5947`, and a sane default. Derive it from a new
`shops.category` the seller picks at onboarding — do not guess from
`products.kind`, which is `physical | digital | service | event` and says
nothing about what the business is. This is the real work in this spec.

**2. Do not request everything.**

Stripe, plainly: *"The capabilities you request for a connected account
determine the information you're required to collect for it. To reduce
onboarding effort, only request the capabilities that your accounts need.
Requesting more capabilities means the onboarding flow must verify more
information."*

Requesting all nine lengthens the KYC form for a home baker who wanted to be
selling in ten minutes. **Ship the curated set first — `link_payments`,
`cashapp_payments`, `us_bank_account_ach_payments`** — and add the BNPL three
only once MCC exists and someone has actually asked. Nobody finances a $45 cake.

**3. All of it sits behind Connect KYC.**

Every method above requires the seller to complete Connect onboarding: legal
name, date of birth, SSN, address, bank account. That is the "live in three
minutes" promise gone, and it is why the two manual links still earn their place
— they serve the seller who has not onboarded and may never want to. It is also
the strongest argument for moving card off the Business plan: gating the whole
US payment stack behind the top tier means the seller hits the wall before they
ever see it work.

## Files

**Stripe half:**

- `src/lib/connect.ts:111` — extend `capabilities` on `accounts.create`.
- `src/lib/connect.ts` — add `mcc` to `business_profile` from the new category.
- A backfill requesting the new capabilities on existing connected accounts via
  `accounts.update`. There is one account. Keep the script; there won't be.
- Dashboard: turn the methods on in [payment method
  settings](https://dashboard.stripe.com/settings/payment_methods), default-on
  for connected accounts.
- `shops.category` — this one **does** need a migration (`drizzle/00NN`), and it
  is the only migration in this spec. Nullable text, backfilled to a default,
  with the picker on the onboarding step and in Settings.

**Link half (Venmo, PayPal.Me):**

- `src/lib/payments/rails.ts` — two entries, `kind: "manual"`,
  `settlesItself: false`, `requires: {}`, no `payInPerson`.
- `src/db/schema/json-types.ts` — `venmoHandle?`, `paypalMe?` on
  `PaymentConfig`. jsonb, so no migration.
- `src/lib/payments/handoff.ts` — two cases plus the shape change below.
- `src/app/[handle]/_components/cart/checkout-copy.ts` — `railCopy` is an
  exhaustive switch, so this is a **compile error** until both land. Let the
  compiler drive the change rather than grepping for call sites.
- `src/i18n/dictionaries/*.ts` — six keys across all 35 locales. `en.ts` is the
  typed source, so a gap anywhere is a compile error. Brand names don't
  translate; only the action and description do.

**Needs no change, and it is worth knowing why:** the admin payments screen
renders whatever `def.fields` declares; the orders list, order row, invoice page
and both `/hq` pages read `PAYMENT_METHOD_DEFS[type].name`. Every one picks these
up for free. That is the payoff of one-definition-per-rail — resist adding a
`switch (type)` anywhere new.

## The link rails' one design decision

`bank_transfer` and `cod` return `{ kind: "instructions", message }`. These two
want *both* — an instructions block, so the buyer knows to come back and
confirm, **and** a button that opens the payment app. Extend the variant rather
than adding a fourth kind:

```ts
| { kind: "instructions"; message?: string; payUrl?: string; payLabel?: string }
```

A `redirect` would be wrong: these do not settle themselves, so the buyer must
return to submit a reference exactly as for a bank transfer. Sending them away
with no way back is how an order goes unconfirmed and the seller ships nothing.

Link formats — Venmo `https://venmo.com/<handle>?txn=pay&amount=<dec>&note=<enc>`
(decimal, no `$`, handle without `@`); PayPal.Me
`https://paypal.me/<handle>/<amount><CUR>`. **Verify the PayPal.Me format against
their docs before shipping** — a wrong path resolves to "user not found" rather
than an error we see. Return `null` on a missing handle, as every other rail
does.

## One thing that will cost a seller money if we skip it

**Venmo prohibits business use on a personal profile.** Personal accounts are
restricted to non-commercial transactions between people who know each other,
and Venmo may *reverse* a payment it judges to be for goods — the seller loses
the money and the item they already shipped. The `venmoHandle` hint must read
**"Your Venmo business profile handle"** and the description must name it.

Not enforceable from our side, so the obligation is discharged by saying it
clearly at the field and nowhere else. We are the screen that told them to do it.

## Zelle is deliberately absent

Zelle's own terms: *"The Service is not intended, and should not be used, for
the purchase of goods from retailers, merchants, or other sellers."* No buyer
protection, no dispute path, no third-party API, and no link format — it lives
inside the sender's bank app. Sellers will ask; the answer is the
`bank_transfer` instructions field, under their own name.

## Edge cases

- **Amounts.** Use the same `computeTotals` figure the order was written with,
  not the subtotal.
- **Currency.** Venmo is USD-only; hide it when the shop currency is not USD and
  say why on the admin card. Cash App Pay is USD and US-buyer-only, and Stripe
  will simply not offer it otherwise — no work needed. PayPal.Me carries its own
  currency suffix.
- **Handles arrive decorated.** Strip a leading `@` and a full
  `https://paypal.me/` prefix — sellers paste the whole link. Same normalisation
  Telegram and Instagram already do.
- **The Venmo note is public by default** on the sender's feed. Invoice number
  only — never an address or a private product title.
- **Reconciliation stays manual for the two links.** Deliberately unsolved:
  solving it means reading the seller's Venmo, which no available API allows.
  Every Stripe method above settles itself, which is the point of doing them
  first.

## Done when

- A US connected account offers Link, Cash App Pay and ACH at checkout, with no
  change to the checkout code — or a capability came back unavailable and
  Stripe's answer is written down here.
- `shops.category` exists, its migration ran against production **before** the
  code shipped, and `mcc` is set on new and backfilled connected accounts.
- A seller can enable Venmo and PayPal.Me, with the business-profile warning on
  the Venmo field; the buyer sees the amount, a pay button and a reference box.
- All 35 dictionaries compile; `npx tsc --noEmit`, `npx vitest run`, the scenario
  suite, `npm run build`, `npx oxlint` and `npx knip` are clean.
- **Scenario coverage** on a Venmo order through `createOrderIntent`: order
  persisted before handoff, invoice claimed, seller notified once, order lands
  `new` and unpaid, marking it paid releases a digital file. Money-path change —
  unit tests are not enough per rule 2, and the memberships work already proved a
  branch missing from `createOrderIntent` passes every direct-module test.
