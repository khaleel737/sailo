---
status: accepted
date: 2026-08-17
decision-makers: Khaleel Musleh
consulted: Stripe documentation, Stripe API (sandbox probe)
informed: engineering
---

# Keep legacy Express connected accounts, and treat the fee payer as the thing that is actually locked in

## Context and Problem Statement

Sailo opens connected accounts with `stripe.accounts.create({ type: "express" })`
and takes direct charges on them with an `application_fee_amount`. Stripe's docs
now mark the legacy account types — Standard, Express, Custom — as **deprecated**,
recommend Accounts v2 for new integrations, and the Node SDK prints
`We recommend building your integration using Accounts v2` on every
`accounts.create` call.

That raises three questions that were being conflated:

1. Does moving to v2 change **who performs KYC**?
2. Does moving to v2 change **what Stripe charges us**?
3. Is `type: "express"` deprecated enough that we have to move at all?

The premise behind the first two — that the API *version* determines KYC and fees
— turns out to be wrong, and getting that wrong in either direction is expensive:
one direction takes on a compliance obligation we are not staffed for, the other
moves Stripe's per-transaction processing fees from our sellers onto us.

## Decision Drivers

* **Fee payer must not change.** Anything that moves Stripe's payment processing
  fees from the connected account onto the platform is not survivable at our
  margins — we keep 1–3% of the goods and Stripe's fee is larger than that.
* **KYC must stay with Stripe.** We do not have a verification, remediation or
  sanctions-screening operation, and building one is out of scope indefinitely.
* **Negative-balance liability is already ours** and is a known, accepted cost;
  we should know whether it is escapable and at what price.
* **Deprecation risk.** A deprecated account type is one Stripe eventually stops
  creating, and discovering that during an outage is the bad version.
* **Seller experience.** The Express Dashboard is cobranded and narrow; the full
  Stripe Dashboard is Stripe's product with Stripe's branding and Stripe's
  support surface.
* **The European payment-method set** (`capabilities.ts`) is a differentiator and
  must not regress.

## Considered Options

* **A — Stay on legacy `type: "express"`**
* **B — Move to Accounts v1 controller properties, keeping the Express dashboard**
* **C — Move to Accounts v2, keeping the Express dashboard**
* **D — Move to Accounts v2 with `dashboard: "full"` and Stripe-collected fees and losses**

## Decision Outcome

Chosen option: **A — stay on legacy `type: "express"` for account creation**,
because it is the only option that preserves the fee payer, and because the two
things that looked like reasons to move (KYC and fees) turn out not to depend on
the API version at all.

Adopt **one piece of v2 separately**: the `customer` configuration, so a seller's
own subscription can be billed against their Stripe balance. This attaches to
existing v1 accounts and touches neither account creation nor the fee payer.

### Consequences

* Good, because the fee payer stays `application_express`, under which **the
  connected account pays Stripe's payment processing fees**. Under plain
  `application` — which is what every non-legacy Express configuration resolves
  to — the *platform* pays them.
* Good, because Stripe continues to collect KYC (`requirement_collection: stripe`),
  which is true of every option except D-with-`dashboard: none`.
* Good, because nothing about the webhook split, the capability table or the
  European payment methods moves.
* Bad, because we stay on a type Stripe calls deprecated, and carry an SDK
  warning on every account creation.
* Bad, because negative-balance liability stays with us, and so do the Connect
  per-account fees (order of €2 per monthly active account and 0.25% + €0.10 per
  payout on Stripe's European pricing page; US figures differ and must be read
  off our own account) and
  the platform-billed add-ons (Stripe Tax, Checkout add-ons, Card Account
  Updater, Instant Payouts, Adaptive Acceptance, Interchange Plus, instant bank
  verifications).
* Neutral, because the decision is reversible for *new* accounts only —
  responsibilities and fee payer are immutable once an account exists, so any
  future move applies to new sellers and leaves the existing book as it is.

### Confirmation

Confirmed against the live API in test mode rather than against the docs, because
two Stripe pages disagreed. Every probe account was deleted afterwards.

| Configuration | v1 | v2 | `requirements_collector` |
| --- | --- | --- | --- |
| `type: "express"` (today) | accepted, `fees=application_express`, `losses=application` | — | **stripe** |
| express + `application` / `application` | — | accepted | **stripe** |
| express + fees `account`/`stripe` + losses `stripe` | **rejected** | **rejected** | — |
| express + fees `application` + losses `stripe` | **rejected** | — | — |
| full + fees `account`/`stripe` + losses `stripe` | accepted | accepted | **stripe** |
| none + `application` / `application` | — | accepted | **application** |

The two rejections carry the reasoning verbatim:

> When `stripe_dashboard[type]=express`, your platform must collect fees and be
> liable for negative balances or refunds and chargebacks.

> When controlling requirement collection, the Connect application must also
> control losses, fees, and specify a dashboard type of `none`.

So: **the Express Dashboard forces platform-collected fees and platform
liability**, in v1 and v2 alike, and **the platform only ever performs KYC at
`dashboard: "none"`** — a configuration nothing here proposes.

Ongoing confirmation: `pnpm --filter @sailo/web check:prices` and `check:stripe`
already reconcile the plan prices and the account against `plans.ts`. Neither
covers the fee payer; if we ever migrate, `accountFields` should start mirroring
`controller.fees.payer` onto the shop row so a change is visible in a diff rather
than in a monthly invoice.

## Pros and Cons of the Options

### A — Stay on legacy `type: "express"`

* Good, because `application_express` keeps Stripe's processing fees on the
  connected account.
* Good, because Stripe collects KYC.
* Good, because it is zero work and zero risk to the money path.
* Bad, because Stripe calls the type deprecated.
* Bad, because platform liability and Connect per-account fees stay ours.
* Neutral, because `application_express` cannot be set on a new account by any
  other means — it exists *only* for legacy `type: "express"`, which is precisely
  what makes leaving it a one-way door.

### B — Accounts v1 controller properties, Express dashboard

* Good, because it sheds the deprecated type without touching the API version.
* Bad, because the Express dashboard forces `fees: { payer: "application" }`,
  and under plain `application` **the platform pays Stripe's payment processing
  fees for every direct charge**. That is the whole margin and then some.
* Bad, because it is a migration whose only benefit is a warning going away.

### C — Accounts v2, Express dashboard

* Good, because it is Stripe's recommended API and unlocks the configuration
  model.
* Good, because the exact shape is accepted — confirmed above.
* Bad, because it resolves to `fees_collector: "application"`, with the same
  processing-fee consequence as B.
* Bad, because the webhook scope boundary moves: for a v2 account representing a
  connected account, v2 events arrive on **Your account** scope while v1 events
  stay on **Connected accounts** — and our two endpoints are split on exactly
  that line.
* Bad, because payment methods in public or private preview still require v1.

### D — Accounts v2, full dashboard, Stripe collects fees and losses

* Good, because it removes negative-balance liability entirely — the largest
  unquantified risk on the books.
* Good, because it removes the Connect per-account fees and the platform-billed
  add-ons, and makes Managed Risk available.
* Good, because the connected account pays processing fees again, as under
  `application_express`.
* Good, because `application_fee_amount` still works — Stripe is explicit that
  platform application fees are "in addition to Stripe fees".
* Bad, because sellers move to the full Stripe Dashboard. That is a product
  decision about what Sailo *is*: a seller who logs into Stripe directly is one
  step from discovering they never needed us for payments.
* Bad, because it cannot be applied to the existing book — responsibilities are
  immutable per account, so this splits sellers into two populations with
  different economics and different support answers, forever.

## More Information

**What would reopen this:** Stripe announcing a creation cut-off for legacy
types; a Stripe-confirmed way to keep `application_express` fee behaviour off the
legacy type; or negative-balance losses growing past the cost of the seller
experience change in D.

**What to ask Stripe**, in one email, before any migration is scheduled:

1. Under Accounts v2 with `dashboard: "express"` and
   `fees_collector: "application"`, who pays Stripe's payment processing fees on
   a direct charge — the connected account, or the platform? This ADR assumes the
   platform, from the published fee-payer table, and the answer decides B and C
   outright.
2. Is there a migration path that preserves `application_express` behaviour?
3. Is there a creation cut-off date for legacy account types?

Related: `docs/payments-compliance.md` §3.2 (negative-balance liability), §3.4
(v1/v2), §10 (pricing and partner commission).
