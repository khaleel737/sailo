# 38 — Tax jurisdictions, thresholds, country control, tax report

**Priority:** P2 · **Effort:** L · **Depends on:** nothing · **Blocks:** nothing

## What

The compliance half Sailo can honestly own: a record of where the seller is
registered, a running count of revenue against each jurisdiction's threshold,
the ability to stop selling into a country before crossing one, and a report
that can be filed. Reference: Easytools Store settings → Invoicing & taxes and
their six-step wizard, `llms-full.txt` §`tax-and-billing-setup` onward.

## What Sailo has, and the line we do not cross

Sailo has two defensible tax modes on `shops` and both are already right:

- `manual` — a flat declared `taxRateBp`, `taxName`, `taxInclusive`,
  `taxOnDelivery`, printed on a numbered invoice from a real sequence.
- `stripe` — Stripe Tax computing from the buyer's location and the seller's
  registrations, **on the seller's own connected account**, because the seller
  is merchant of record and the liability follows them. The schema comment says
  this and it is the whole architecture.

Easytools' recommended option is **Easybilling at $0.50/transaction**: they
calculate, issue, process refunds and answer the buyer's billing mail. That is
a staffed operation carrying tax liability, and it is the same
merchant-of-record posture Sailo has deliberately refused
(`GAP-2026-08-easytools.md` §4.3). **We do not become a tax provider.**

What we build is the part that protects the seller *without* taking their
liability, and every piece of it is bookkeeping over data we already hold.

## Data model (migration, production first)

`drizzle/NNNN_tax_jurisdictions.sql`.

```
tax_jurisdictions  id, shop_id → shops(cascade),
                   country text not null,      -- ISO 3166-1 alpha-2
                   region text,                -- US state, CA province
                   registration_number text,
                   registered_on date, expires_on date,
                   rate_bp integer,            -- optional local override
                   created_at, updated_at
                   unique (shop_id, country, region)

tax_country_rules  shop_id → shops(cascade),
                   country text not null,
                   sales_enabled boolean default true,
                   auto_disabled_at timestamp,   -- set by the monitor
                   auto_disabled_reason text,
                   primary key (shop_id, country)

tax_revenue_daily  shop_id, country text, region text, day date,
                   net_cents bigint, tax_cents bigint,
                   b2b_net_cents bigint, order_count integer
                   primary key (shop_id, country, region, day)
```

`shops` gains `taxOssRegistered boolean default false` (the EU one-stop-shop
case), `taxDisableOnThreshold boolean default false`,
`taxDisableImmediateObligation boolean default false`, and
`taxCategory text` (their "General tax category" — the product-type input to a
rate, and a per-product override on `products.taxCategory`).

**Thresholds are reference data, not seller data.** A checked-in table in
`packages/core/src/money/tax-thresholds.ts` — country, region, amount, currency,
period, and `immediate: true` for the places with no threshold at all (their
example is Peru; the EU is the €10,000-combined special case). It carries a
`reviewedOn` date and a comment saying it is a starting point a seller must
confirm, because thresholds move and a stale number presented as advice is
worse than no number.

## Behaviour

**Registered jurisdictions** — a table on the settings tab: jurisdiction,
registration date, expiry, number. Exactly their screen. Under `taxMode =
'stripe'` these are informational and Stripe's own registrations decide the
rate; under `manual` an entry's `rate_bp` may override the flat rate for that
country. **Say which is which on the screen**, because a seller who adds a
registration and sees no rate change will otherwise file a bug.

**Threshold monitoring** — a daily job aggregating paid orders into
`tax_revenue_daily` from data we already have (`orders.taxRateBp`,
`orders.currency`, the buyer country on the order). Per jurisdiction, show
revenue, threshold, and remaining — their four columns. Only sales to
**individuals** count toward a threshold: their note is correct and material
(*"When selling to companies outside your home country, there's typically no
sales tax to collect"*), which is why `b2b_net_cents` is separate rather than a
filter applied later.

**Alerts** at 70% and 90%, once each, claimed in a conditional UPDATE. Mailed
to `notificationEmail` through the notification prefs that already exist.

**Country control** — enable or disable selling per country. Two automatic
switches, theirs:

- disable countries with an **immediate** obligation (no threshold at all);
- auto-disable on **approaching** a threshold, recording
  `auto_disabled_reason` so the seller knows the panel did it and why.

Enforcement is at **checkout, server-side**: a disabled country is absent from
the country list *and* refused if submitted. A client-side-only list is a
suggestion. This wires into the country list `0019_shipping_zones` already made
real.

**Tax report** — per period, per jurisdiction: net, tax, order count, B2B split,
CSV. This is what the seller files. It reads `tax_revenue_daily` and reconciles
against `invoices`, and the reconciliation is the test: a report that disagrees
with the invoice sequence is a report nobody can file.

## Details that must not be missed

- **The three-decimal currencies.** `PRODUCTION-PLAN.md` records five currencies
  quoted to three places and settled to two being charged an amount their own
  invoice did not say. Every aggregate here is a **sum of stored minor units**,
  never a re-derivation from a rate. Do not recompute tax from `taxRateBp` ×
  net; sum `orders.tax_cents`.
- **Revenue is counted in the order's own currency**, and a threshold is in the
  jurisdiction's. Store both, convert **at display time only**, and show the
  rate and date used. A stored converted number is wrong the next day and
  unauditable.
- **A disabled country must not break an existing subscription's renewal.**
  A member in a country the seller later disabled keeps renewing; the switch
  governs *new* checkouts. Otherwise a compliance toggle silently cancels
  paying members.
- **Never present any of this as tax advice.** One line on the tab, and a link.
  Their own wizard says *"We make this process easy to understand but not
  automatic, as we believe you being responsible for your business is a good
  thing"* — that is exactly the right register and Sailo should adopt it.
- **`taxCategory` changes nothing under `manual`** and only feeds Stripe Tax.
  Hide it in manual mode rather than offering a control that does nothing —
  the pattern `taxIdCollection` already follows.
- **VIES / tax-id validation is Stripe's**, under `stripe` mode, and does not
  exist under `manual`. Do not build a VIES client.
- **The onboarding wizard is optional.** Theirs is six steps and good; ours can
  be four cards on the existing tab. Ship the data model and the tab first; the
  wizard is a follow-up that changes no schema.
- 35-locale strings: the tab, the threshold table, two alert emails, the report.

## Testing

Unit: threshold arithmetic including the EU combined case and an `immediate`
jurisdiction; B2B exclusion; alert at 70/90 fires once each; the country
predicate for enabled / disabled / auto-disabled; three-decimal currency sums
proven against stored minor units, not rates.

Scenario: paid orders in three countries aggregate correctly; a disabled country
is absent from the checkout list **and** refused when submitted directly; an
existing subscription in a disabled country still renews; crossing 70% mails
once under two ticks; the tax report reconciles to `invoices` for the period;
a refund reduces the period it belongs to.

## Done when

A seller records registrations, watches revenue against real thresholds, is
warned before crossing one, can switch a country off in a way the server
enforces, and can export a report that reconciles to the invoice sequence —
with nothing anywhere claiming to be tax advice.
