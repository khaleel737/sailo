# 46 — Platform subscription disputes: Sailo's own evidence

**Priority:** P1 · **Effort:** M · **Depends on:** 44 (`account_events`, and
Sailo's own policy snapshots) · **Blocks:** nothing

## What

When a seller charges back their own Sailo subscription, Sailo is the merchant
of record and Sailo answers it. This spec is the evidence pack for that case,
and the desk to submit it from.

## The gap, in the schema's own words

`packages/db/src/schema/disputes.ts` already draws the distinction correctly:

> `platform` — a seller charged back their own Sailo subscription. Sailo's own
> balance is debited, and the remedy is **a plan downgrade rather than evidence
> about a parcel**.

That is right about the *remedy* and it has quietly become a decision not to
**defend**. Verified: `assembleEvidence` has no platform branch — every field
resolver in `assemble.ts` reads an order, a shipment, a download log or a
duplicate candidate, and a subscription dispute has none of those. So today a
seller charges back $49, Sailo loses $49 plus a $15 dispute fee, downgrades them,
and submits nothing.

Two reasons that is worth fixing beyond the $64:

1. **A SaaS subscription is among the most defensible things there is.** The
   argument is not about a parcel arriving — it is *"this account signed up on
   this date from this address, accepted these terms, signed in 47 times since,
   published a storefront, and processed 340 orders in the month they say they
   never authorised."* That is a stronger record than most physical sellers can
   produce, and it is all in our database.
2. **Sailo's own dispute rate is Sailo's exposure.** `core/disputes/rate.ts`
   measures shops against the networks' thresholds. The platform Stripe account
   has a rate of its own, and uncontested subscription chargebacks accumulate on
   it. A payment processor that decides Sailo is a chargeback risk is a
   platform-level event, not a $49 one.

## Data model (migration, production first)

`drizzle/NNNN_platform_evidence.sql`. Small — most of the data exists.

```
platform_usage_daily  shop_id → shops(cascade), day date,
                      signins integer default 0,
                      orders_processed integer default 0,
                      products_active integer default 0,
                      emails_sent integer default 0,
                      storefront_views integer default 0,
                      admin_actions integer default 0
                      primary key (shop_id, day)
```

One aggregate table, written by the existing daily rollup, because the raw
sources are on different retention clocks and some are pruned: `visit_daily` is
analytics and swept, `account_events` (spec 44) is kept 400 days, orders are
permanent. An evidence claim must not depend on a table that empties itself —
the same problem that makes `session` unusable for this and the reason spec 44
adds `account_events`.

Everything else is read live:

| Evidence | Source |
|---|---|
| Signup date, IP, user agent, geo | `account_events` kind `signup` (spec 44) |
| **Sailo's** terms accepted, when and which text | `account_events` kind `terms_accepted` + `policy_snapshots` for `shop_id IS NULL` (Sailo's own) |
| Sign-in history | `account_events` kind `signin` |
| Subscription history, plan changes | `shops.plan`, `subscriptionStatus`, `subscriptionInterval`, `currentPeriodEnd`, `cancelAtPeriodEnd` + `account_events` kind `plan_change` |
| Invoices issued and sent | Stripe invoices on the platform customer, and the receipt emails |
| Service actually used | `platform_usage_daily` |
| Cancellation available and never used | `cancelAtPeriodEnd` never set + the billing portal link in every receipt |

`shops.stripeCustomerId` → `shopIdFor` is the existing route from a platform
charge to a shop; `record.ts` already resolves it, which is why
`disputes.shopId` is populated on platform disputes today.

## Sailo's own policy snapshots

Spec 44 adds `policy_snapshots` keyed on `shop_id`. Sailo's own terms, privacy
and refund pages — `(legal)/terms` (653 lines), `privacy` (584), `refunds` (344),
which `PRODUCTION-PLAN.md` §4 rules "leave whole: prose is data" — need
snapshotting too, with `shop_id IS NULL` meaning *the platform's own*.

Snapshot on deploy, content-addressed, so one row per version. Then
`account_events.kind = 'terms_accepted'` points at the exact text a seller
accepted at signup. Without that, Sailo's `cancellation_policy_disclosure` is a
link to a page that has since changed — the same weakness spec 44 fixes for
sellers, and it applies to us.

## What gets submitted, per reason code

`core/disputes/reasons.ts` holds the reason→field mapping as data. Add a
**platform** variant rather than branching inside the existing resolvers: same
shape, different holdings type, so `assemble.ts` stays pure and each branch stays
reachable from a test.

| Reason | The argument that wins it |
|---|---|
| `subscription_canceled` (Visa 13.2 / MC 4841) | **Use after the claimed cancellation date.** `platform_usage_daily` sign-ins and orders processed, plus the fact `cancelAtPeriodEnd` was never set and a self-service cancel link was in every receipt |
| `unrecognized` (10.4 / 4837) | The statement descriptor on **Sailo's own** platform account (spec 44 sets one for sellers; set ours too), plus the receipt emailed to the address on the account, plus sign-ins from the same IP range as the signup |
| `fraudulent` (10.4 / 4837) | Signup IP, device, sign-in history, terms acceptance, and usage. Also check CE3 — a seller with two prior undisputed subscription payments 120–365 days back sharing two match points is a **rule** win, not an argument. `ce3.ts` is already written; it needs a platform-side identity mapper |
| `product_not_received` (13.1 / 4855) | Access was granted immediately and used. The `access_activity_log` here is sign-ins, not downloads |
| `credit_not_processed` (13.6 / 4860) | If we owed a refund and did not process it, **refund and stop** |
| `duplicate` (12.6 / 4834) | Stripe's subscription invoices are sequential; name the other invoice. A real duplicate is our bug — refund it |

## When not to contest — the rule that matters most

**If the seller is right, refund.** A subscription dispute is often a
cancellation that did not work, a card that kept being charged after a downgrade,
or a trial that converted without notice. Those are our bugs, and contesting one
is both dishonest and a loss: we would spend the fee, lose anyway, and add a
loss to the platform's rate.

So the desk shows, beside the evidence, the three questions that decide whether
to fight:

1. Did the seller ever set `cancelAtPeriodEnd`, and did we bill after it?
2. Was there usage in the disputed period?
3. Did we send a receipt to a working address, and did it bounce?

A "no" on 2 with a "yes" on 1 is a refund, and the desk should say so rather than
offering a submit button. `escalation.ts` already models graded responses;
"refund, do not contest" is a first-class outcome here, not an absence of action.

## Behaviour

**The desk.** `/hq/disputes` already exists and lists disputes with a deadline
queue (`disputes_status_due_idx`). Platform-scope rows currently render with
nothing to act on. They gain: the evidence readiness panel (the same component
the connected side uses, different holdings), the three decision questions, a
generated platform evidence PDF (spec 45's renderer, platform sections), and a
submit action.

**Gated by a named capability**, never a bare `requireStaff()`. The auto-memory
rule is explicit and this hole has shipped once: *"every HQ write names a
`StaffCapability`."* Submitting evidence on Sailo's behalf and issuing a refund
of Sailo's revenue are two different capabilities, and neither is `disputes.view`.

**Deadline notification.** The three `seller*NotifiedAt` claims on `disputes` are
for telling a *seller* about their dispute. A platform dispute needs the opposite
— tell **staff**, on the same conditional-update claim so a retried webhook does
not page twice. Reuse the pattern; do not reuse the columns, which mean something
else. Add `staffNotifiedAt`, `staffDeadlineNotifiedAt`.

**The remedy stays.** The existing downgrade on a lost platform dispute is
correct and keeps working. Contesting and downgrading are not exclusive: hold the
downgrade until the case closes where the deadline allows it, and reinstate on a
win — `fundsReinstatedAt` already exists and is the signal.

**Repeat offenders.** A shop with a second platform chargeback should not be able
to re-subscribe by card. Record it and refuse the card rail for that customer,
offering nothing else — this is a normal risk control, and `shops.payoutsPausedAt`
/ `suspendedAt` show the pattern the codebase already uses for graded seller
restrictions.

## Details that must not be missed

- **The platform fee asymmetry is already documented and is worse here.**
  `docs/chargebacks.md`: a lost chargeback does not return the application fee,
  unlike a refund. On a platform dispute there is no application fee — Sailo
  loses the whole subscription amount plus the fee. Show the true deducted
  figure from the balance transaction (`deductedCents` already stores it), never
  `dispute.amount`.
- **A platform dispute must never enter a shop's connected dispute rate.**
  `disputes_shop_scope_idx` exists for this and `rate.ts` scopes it — add a
  scenario that would fail if the filter were dropped, because this is the shape
  of bug that suspends a seller for arithmetic.
- **The pack contains the seller's personal data**, not a buyer's. Sailo is the
  data controller for it, which is the easier position — but it is still an
  access-controlled document, staff-only, and the disclosure to a card network is
  a lawful-basis line in the privacy policy.
- **Never submit usage data that is a guess.** `platform_usage_daily` is written
  by a rollup; a day it never ran is a zero that reads as "did not use the
  service". Store a `rolledUpAt` marker or leave gaps explicitly labelled. A
  false zero argues our own case against us.
- **Sailo's statement descriptor.** Set one on the platform account. `SAILO` is
  recognisable; a legal entity name is not, and `unrecognized` is the reason
  code this fixes for free.

  > **Measured, 19 August 2026 — the API cannot set it.** `accounts.update` on
  > your own account is refused ("you may only use it on connected accounts"),
  > `POST /v1/account` is live-keys-only, and stripe-node has no `updateCurrent`.
  > It is a Dashboard setting. The deploy step therefore *checks* and prints the
  > task; and the evidence now quotes the descriptor **read from the live
  > account** rather than the constant, because a line saying "the charge
  > appeared on the statement as SAILO" is a claim about a cardholder's bank
  > statement and must not rest on a string literal. `docs/chargebacks.md` §11.
- **Inquiries are not chargebacks here either.** `isInquiry` keys on the
  `warning_` status prefix and applies unchanged. Answer an inquiry well and it
  usually does not become a chargeback — and no money has moved, so the downgrade
  must not fire.
- HQ is not translated to 35 locales; no dictionary work.

## Testing

Unit (pure): the platform holdings → field resolver for all six reason codes;
the three decision questions over the cases that matter (cancelled-then-billed,
no-usage-no-cancel, usage-after-claimed-cancellation); CE3 identity mapping for
platform charges; usage-gap labelling.

Scenario: a platform dispute records with `shopId` resolved from
`stripeCustomerId` and `orderId` null; it does **not** appear in the shop's
connected dispute rate; evidence assembles from `account_events` and
`platform_usage_daily` with no order present; a cancelled-then-billed case
surfaces "refund, do not contest" and offers no submit; an inquiry does not
downgrade and moves no money; a won dispute sets `fundsReinstatedAt` and
reinstates the plan; a second chargeback from one customer refuses the card
rail; staff deadline notification sends once under two ticks; submitting without
the named capability is refused and writes no row.

## Done when

A seller's subscription chargeback arrives, HQ sees a complete evidence pack
built from signup, terms acceptance, sign-in history and real usage, is told
plainly when the seller is right and we should refund instead, submits with a
named capability when they are not, and the case never touches that shop's own
dispute rate.
