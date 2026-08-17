---
status: accepted
date: 2026-08-17
decision-makers: Khaleel Musleh
consulted: Stripe documentation, Stripe API (sandbox probe), ADR 0001
informed: engineering
---

# Buy one piece of Accounts v2 now, and treat the rest as an option we are not exercising yet

## Context and Problem Statement

ADR 0001 answered a technical question — can we migrate, and what breaks — and
concluded: stay on legacy Express. That left the commercial question unanswered,
and it is the one that actually decides this: **what does Accounts v2 let Sailo
sell, save, or become that v1 does not?**

The honest starting point is that v2 is not an upgrade in the sense of "the same
thing, better". It is a different way of *describing* a connected account, and
what it unlocks is a set of money-movement products Sailo does not currently
sell. So the decision is not "is v2 better" — it is **"do we want to be in those
businesses, and if so, when."**

This ADR ignores implementation entirely. Webhook scopes, capability tables and
field names are ADR 0001's problem.

## Decision Drivers

* **Margin on our own subscription revenue.** We collect $19 and $49 by card and
  pay card fees to do it. Anything that reduces that is margin we keep.
* **Involuntary churn.** A seller who wants to stay but whose card expired is
  revenue we lose for no reason, and it takes the partner's commission with it.
* **Optionality on money movement.** Seller balances, instant payouts, issuing —
  these are revenue lines, and the question is whether we are buying the right
  to launch them later.
* **Positioning.** Sailo's whole pitch is "your shop, your money, we're just the
  software." Anything that makes us look like we hold funds is a strategic cost,
  not just a compliance one.
* **Engineering time is the scarcest input.** Every week on plumbing is a week
  not on the product sellers actually buy.

## Considered Options

* **A — Stay entirely on v1.** Change nothing.
* **B — Adopt v2 only to bill sellers from their Stripe balance.** Leave account
  creation, charge type and dashboard alone.
* **C — Move new account creation to v2.** Same shape, newer API.
* **D — Move to v2 with the full Stripe Dashboard and Stripe-collected fees and
  losses.** The "lighter platform" play.

## Decision Outcome

Chosen option: **B — adopt v2 only for billing sellers**, because it is the only
option with a revenue effect we can name today, and the only one that does not
also change something we have deliberately decided not to change.

A and C and D all stay available afterwards. B does not close any door.

### Consequences

* Good, because it attacks the one cost we pay on our *own* revenue rather than
  our sellers'. The arithmetic, with the rate left as a variable because
  Stripe's pricing page geo-serves and ours must be read off our own account:
  a card charge costs `rate × plan + fixed`, and the *fixed* part is what hurts
  on a $19 plan. At a commonly published US online rate of 2.9% + 30¢ that is
  about **85¢ on $19 — 4.5% of the plan** — and about $1.72 on $49, roughly
  3.5%. Paying from a seller's Stripe balance moves the money inside Stripe
  instead of across the card networks, and removes the fixed component
  entirely. **Confirm our actual rate before sizing this.**
* Good, because a card that expires is the most avoidable churn there is, and it
  is doubly expensive here — a lapsed seller stops paying us *and* stops paying
  their referring partner, who then has one less reason to keep promoting.
* Good, because it removes the second object we keep per seller (a Customer
  beside their Account), which is a small ongoing tax on every billing change.
* Bad, because it only helps sellers who **have** a Stripe balance when the
  invoice falls due. A seller doing two orders a month is paid out and near zero
  most of the time, so this helps our best customers and does nothing for our
  smallest. That is the right direction — the sellers worth retaining are the
  ones it works for — but it is not a universal fix and should not be sold
  internally as one.
* Bad, because it is engineering time on billing plumbing.
* Neutral, because it is reversible: a seller can keep a card on file as the
  fallback, which they need anyway for the months their balance is short.

### Confirmation

Two numbers decide whether this was worth doing, and neither is a code metric:

1. **Card fees paid on our own subscription collections**, before and after.
   Target: down by whatever share of sellers can pay from balance.
2. **Involuntary churn rate** — subscriptions ending in `unpaid`/`canceled`
   after a failed payment, as a share of all cancellations. This is also the
   number that tells the partner programme how much commission it is losing to
   plumbing rather than to sellers leaving.

One commercial fact to confirm with Stripe before building: whether Stripe
charges the platform for a balance-funded charge, and at what rate. Stripe's
Connect pricing page lists a 1% figure against "transaction fees on Stripe
balance transfers" in a context that reads as *platform revenue opportunity*
rather than platform cost. If it is a cost, 1% still beats ~4% on a card, but it
changes the size of the win and should be known before the work is scheduled.

## Pros and Cons of the Options

### A — Stay entirely on v1

* Good, because it costs nothing and risks nothing.
* Good, because our sellers keep paying Stripe's processing fees. Under legacy
  Express that is how it works, and it is the single most valuable property of
  our current setup — see ADR 0001.
* Bad, because we keep paying card fees to collect our own subscriptions.
* Bad, because we hold no option on any money-movement product. The day we want
  seller balances or instant payouts, we start from zero.
* Neutral, because legacy Express has no announced end date, so "do nothing" is
  not currently a countdown.

### B — Adopt v2 only to bill sellers (chosen)

* Good, because it is the only option whose benefit lands on the P&L this
  quarter rather than as optionality.
* Good, because it touches nothing sellers can see. No change to their
  dashboard, their payouts, their fees, or who is merchant of record.
* Good, because it is the cheapest possible way to learn v2 — one configuration,
  one billing path, on accounts that already exist.
* Bad, because the benefit scales with seller balance, so it under-delivers on
  the long tail.
* Neutral, because it does not advance us toward D if we ever want it; the
  hard part of D was never the API.

### C — Move new account creation to v2

* Good, because it clears a deprecation warning and puts new sellers on the API
  Stripe is building toward.
* Bad, and decisively: it flips who pays Stripe's card processing fees from the
  seller to Sailo. That is larger than our entire 1–3% take on the goods. We
  would be paying for the privilege of processing our sellers' sales. See ADR
  0001 for the mechanism and the verification.
* Bad, because it splits the book into two populations with different unit
  economics, permanently — the settings are immutable per account.
* Neutral, because the deprecation warning costs us nothing today.

### D — Full Stripe Dashboard, Stripe collects fees and losses

This is the only option that is a genuine strategy rather than a migration, so
it deserves the longest entry.

* Good, because it removes negative-balance liability entirely. Today an
  unrecoverable negative balance on any seller is ours, Stripe can hold a
  reserve against our own account to cover it, and we cannot use Managed Risk
  while that is true. This is the largest unquantified number on our books.
* Good, because it removes the Connect per-account fees and the platform-billed
  add-ons (Stripe Tax, Checkout add-ons, Card Account Updater, Instant Payouts,
  Adaptive Acceptance, instant bank verifications). Stripe's European pricing
  page states those Connect fees as **€2 per monthly active account** and
  **0.25% + €0.10 per payout sent** under the "you handle pricing" model, and
  nil under "Stripe handles pricing"; the US figures differ and must be read off
  our own account. Whatever the exact number, this is a per-seller cost that
  scales linearly with success and simply disappears under D.
* Good, because sellers pay Stripe's processing fees again, as they do today,
  and we keep charging our own 1–3% application fee on top. Stripe is explicit
  that platform application fees are "in addition to Stripe fees".
* Good, because it is the honest end state of our own positioning. We say we are
  software and not a payments company; D is what that looks like when Stripe
  agrees.
* **Bad, and this is the whole argument against it:** sellers get the full
  Stripe Dashboard. They log into Stripe, with Stripe's branding, and see that
  Stripe is doing the payments. A seller one click from that realisation is a
  seller who can ask what they are paying us for. The Express Dashboard being
  cobranded and narrow is not a limitation we tolerate — it is a moat.
* Bad, because it cannot be applied to existing sellers. Responsibilities are
  fixed at account creation, so this creates two populations with different
  economics, different liability and different support answers, forever.
* Bad, because we lose the ability to pause a seller's payments or payouts —
  that is a platform power that comes *with* holding the liability, and our
  Terms clause 9 currently reserves it. Giving up the liability gives up the
  lever.
* Neutral, because the engineering is not the hard part. The hard part is
  deciding we are comfortable introducing our sellers to our supplier.

## More Information

**The shape of the decision.** v2's real product is *optionality on money
movement* — seller balances, instant payouts as a revenue line, issuing, holding
funds. Every one of those is a business Sailo has deliberately said it is not in,
in its own Terms. So v2's headline benefit is one we are currently choosing not
to want. That is a fine reason to defer it and a bad reason to dismiss it: the
day the roadmap includes seller balances or instant payouts, this ADR is wrong
and should be superseded.

**What would move us to D**, in order of likelihood:

1. Negative-balance losses growing past the cost of the seller-experience
   change. Track the number first — we cannot make this call without it.
2. Connect per-account fees becoming material as the seller base grows. At the
   order of €2 per active account per month, this is a line that scales
   linearly with success and is invisible until it isn't.
3. Stripe announcing an end date for legacy Express, which forces a choice
   between C's fee trap and D's positioning cost — at which point D is clearly
   the better of the two.

**What would move us to C:** essentially only a Stripe-confirmed way to keep
legacy Express fee behaviour on a non-legacy account. Worth asking; not worth
waiting for.

Supersedes nothing. Complements [ADR 0001](0001-connect-account-shape.md), which
holds the technical verification and the sandbox matrix. Related:
`docs/payments-compliance.md` §3.2 (liability), §10 (pricing and partner
commission).
