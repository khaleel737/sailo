# 49 — Membership depth: terms, policy, pause, seats, dunning, upgrade paths

**Priority:** P1 · **Effort:** L · **Depends on:** 36 (the `offers` table, for
membership cross-sell) · **Blocks:** nothing

## What

Memberships are billing-complete and product-incomplete. Seven gaps, all of them
things a member or a seller asks for in the first month of selling one.

## Where it stands

Verified: `subscriptions` carries `billingMode` (`stripe` | `manual`), `status`,
`currentPeriodEnd`, `cancelAtPeriodEnd`, `canceledAt`, `trialEndsAt`,
`priceCents`, `interval`, `intervalCount`, `applicationFeeBp`,
`renewalOrderedFor`, `passCode`. Access is decided at read time by
`membershipAccess`, on both rails, with grace to `currentPeriodEnd`.
`member_checkins` and door passes work.

**Correction to `docs/specs/README.md`:** its memberships note says weekly
billing is not built because *"`BILLING_INTERVALS` is still `month | year`"*.
That is now stale — it reads `["day", "week", "month", "year"]` in
`packages/commerce/src/memberships/memberships.ts:33`. Fix the note; it will
otherwise send somebody to build something that exists.

## 1. Fixed term, and access after it ends

Easytools: *"Automatically canceling the subscription after a set number of
cycles… If you choose automatic cancellation, you can decide whether to maintain
access to the product after this period, simulating an installment payment."*

That second half is the interesting one — it is how a seller sells a course in
three payments without Sailo building an instalments engine (which
`GAP-2026-08-easytools.md` §4.7 refuses on money-path grounds). A fixed-term
subscription that keeps access is a payment plan expressed in a model that
already works, with none of the partial-delivery problem: access is granted from
the first payment either way, so a failed third cycle costs the seller a payment
rather than leaving an entitlement half-earned.

```
products
  term_cycles integer            -- NULL = open-ended (today)
  access_after_term boolean default false

subscriptions
  cycles_paid integer default 0 not null
  term_cycles integer            -- snapshot at signup
  access_after_term boolean default false not null
  ended_reason text              -- term_complete | canceled | expired | disputed
```

- `cycles_paid` increments **in the same conditional UPDATE that records the
  period**, beside `renewal_ordered_for` and `membership_period_end` — those
  columns exist precisely because a seller toggling paid→unpaid→paid must buy one
  month, not three. Cycle counting has the identical hazard.
- On reaching `term_cycles`: `cancel_at_period_end` on Stripe, or stop raising
  manual renewals. Then `access_after_term` decides whether `membershipAccess`
  keeps returning true.
- `membershipAccess` gains **one** branch — "term complete and access retained" —
  and nothing else forks. It has exactly one meaning of access on two rails today
  and that is why the grace rule, the members list, the download gate and
  cancellation needed no second implementation. Keep it that way.

## 2. Cancellation policy: minimum term, notice period, immediate cancel

Sailo can only `cancel_at_period_end`. Easytools offers **cancel immediately**
(access lost at once) or at period end, and shows the seller what each does
before confirming.

```
products
  minimum_term_cycles integer     -- cannot cancel before N cycles
  cancel_notice_days integer      -- notice runs before the period end
  cancel_policy_note text         -- shown at checkout and on cancel
```

- **The policy must be disclosed at checkout to be enforceable**, and it feeds
  `cancellation_policy_disclosure` — a real Stripe evidence field, and the thing
  that decides Visa 13.2. Snapshot it onto the order through spec 44's
  `policy_snapshots`, so a dispute five months later cites the terms the member
  actually saw.
- **Immediate cancel is a seller action with a money question.** It ends access
  inside a period the member paid for, so it must either refund pro-rata or say
  plainly that it does not. Offer both, default to no refund, and record which in
  `ended_reason` — a member who loses access mid-month with no refund and no
  record is a chargeback with our own panel as the evidence against us.
- **A minimum term does not trap a member on the manual rail.** They can always
  stop paying; the term governs what the seller may say about it, not a lock.
  Say so in the copy rather than implying an obligation Sailo cannot enforce.

## 3. Pause / freeze

Named "not built" in the memberships notes and asked for by every gym, class
studio and co-working desk — a member going away for a month wants to freeze, not
cancel, and a seller would far rather freeze them than lose them.

```
subscriptions
  paused_at timestamp
  paused_until timestamp
  pause_days_used integer default 0 not null
products
  pause_max_days integer          -- NULL = pausing not offered
```

- **Card rail:** Stripe's `pause_collection` with `behavior: void`, and
  `current_period_end` is pushed by the pause length on resume. Stripe owns the
  billing clock; we do not recompute it.
- **Manual rail:** the renewal cron skips while paused and the period end moves
  by the paused days. `renewal_ordered_for` already guards double-raising.
- **`membershipAccess` returns false while paused.** A pause that keeps access is
  a free month, and the whole point is that the member is not using it. Door
  passes must fail closed on a paused subscription — that is a read-time check
  the pass already performs, so it needs no new code, but it needs a test.
- `pause_max_days` and `pause_days_used` stop a rolling permanent pause.

## 4. Seats: multiple subscriptions bought together and assigned

Easytools: *"Allowing the purchase of multiple subscriptions at once - this
option, combined with the purchase for someone else feature, enables buying
corporate subscriptions and then assigning them to employees."*

This is the one genuinely new shape here, and it is what turns a membership into
something a company buys.

```
subscriptions
  seats integer default 1 not null
  parent_subscription_id → subscriptions(set null)   -- seat rows point at the payer

subscription_seats  id, subscription_id → subscriptions(cascade),
                    email text, name text,
                    pass_code text,          -- each seat its own credential
                    invited_at, accepted_at, revoked_at
                    unique (subscription_id, email)
```

- **The payer holds the billing relationship; each seat holds its own access.**
  `quantity` on the Stripe subscription is the seat count, so the price is
  Stripe's arithmetic and not ours.
- Each seat gets its **own** `pass_code`. A shared code for eight employees is one
  code at the door, which defeats attendance entirely.
- `membershipAccess` for a seat reads the **parent's** status and period end. One
  source of truth for whether the money is good; the seat only says who.
- Revoking a seat frees it for reassignment; reducing `seats` below the accepted
  count is refused with the number, not silently truncated (rule 8).
- **This is the only place buyer identity comes close to needing an account**, and
  it still does not: a seat is reached by a signed token like everything else
  (§4.8 stands).

## 5. Dunning — say something before Stripe gives up

Sailo's grace rule is correct: a `past_due` card member keeps access while Stripe
retries, a manual one does not because nothing is retrying. What is missing is
**telling anybody**. Easytools sends an email per failed attempt, up to three,
then expires — and lets the member force a retry from the portal.

```
subscriptions
  dunning_attempts integer default 0 not null
  dunning_last_sent_at timestamp
```

- Driven by `invoice.payment_failed` on the card rail (already a handled event)
  and by the renewal cron on the manual rail.
- Each send **claimed** by conditional UPDATE — the `sellerOpenedNotifiedAt`
  pattern on `disputes` is the model, and the reason is identical: Stripe
  delivers at least once and out of order.
- The member's email carries a link to **Stripe's own billing portal** to fix the
  card. Sailo must not collect a card here; that is the rule that keeps a button
  from claiming "fixed" while the charge keeps failing.
- The seller gets one notification too, through existing `notificationPrefs`
  (`subscription renewal failed` is already a listed event).
- **This is spec 32's sibling, not its duplicate.** 32 recovers a checkout that
  never completed; this recovers a renewal that already existed. Same email
  discipline, different trigger, and neither may double-send.

## 6. Cross-sell and upgrade paths

Spec 36 refuses instant-charge cross-sell for subscriptions — correctly: a
recurring product cannot ride a one-time basket, and a saved-card charge would
create a subscription nobody consented to the terms of. But *offering* a
membership after a one-off purchase is the highest-value cross-sell a creator
has, and today there is no path at all.

- **A membership may be a cross-sell offer**, routed to a real checkout rather
  than instant-charged. Spec 36 already defines that fallback for anything needing
  more information; a subscription always needs more information (its terms).
- **Upgrade / downgrade between variants** is the other half, and the memberships
  notes list "plan switching" and "proration UI" as not built. Ship switching
  without a proration UI: switch at period end by default (no proration, no
  surprise invoice), and offer immediate switching *only* where Stripe's own
  proration produces the number — never one Sailo computes. `subscriptions` gains
  `pending_product_id` and `pending_effective_at` for a scheduled switch.
- `offers` gains nothing: `offer_product_id` already points at any product.

## 7. Coupons on memberships — keep the refusal, improve the message

The memberships notes record coupons on memberships being *"refused with a
message rather than silently ignored — Stripe's subscription discounts are their
own system with their own duration rules."* That is right and stays.

What can be added honestly is a **first-period discount** where Stripe expresses
it — `coupon` with `duration: once` on the subscription — because that is Stripe's
arithmetic, not ours. Anything requiring "20% off for three months" stays refused
until somebody wants it enough to model duration properly.

## Details that must not be missed

- **Every one of these seven is a money-path change** and needs scenario
  coverage, not unit tests. Four defects in the original memberships release were
  found only by writing scenarios — the partial-index `ON CONFLICT`, the
  out-of-order `customer.subscription.*`, the sweep cancelling a trialling
  member, and the missing `createOrderIntent` branch that lint caught and every
  test missed.
- **Nothing here may fork `membershipAccess` beyond the one term branch.** Its
  single-implementation property is why the grace rule, the members list, the
  download gate, the door pass and cancellation all work without a second copy.
- **Free trials on manual rails** are spec 43. Do not build them twice.
- **The members list** gains: status including paused, seats used, cycles paid of
  term, dunning attempts. It is the seller's whole view of the membership and it
  currently shows almost none of this.
- Plan gate: fixed term and pause on Pro; seats and switching on Business.
- 35-locale strings: cancel/pause/seat UI, four member emails (dunning, paused,
  resumed, term complete), the checkout policy block.

## Testing

Unit: cycle counting under toggle paid→unpaid→paid (buys one cycle);
`membershipAccess` across paused, term-complete-with-access, term-complete-
without, past_due on each rail, and seat-reads-parent; minimum-term and notice
arithmetic across month boundaries; seat count vs accepted count refusal.

Scenario: a 3-cycle term stops billing and retains or drops access per the flag;
pause skips a manual renewal and moves the period end, and the door pass fails
closed while paused; a seat holder's pass admits and the parent's cancellation
stops all seats; dunning sends once per failed attempt under two ticks and never
twice for one event id; a membership cross-sell routes to a real checkout and
never instant-charges; a scheduled switch takes effect at period end and not
before; immediate cancel records `ended_reason` and its refund decision.

## Done when

A seller sells a 12-cycle course that keeps access, freezes a member for a
holiday, sells eight seats to a company where each employee scans their own pass,
tells a member their card failed before Stripe gives up, offers a membership after
a one-off sale, and lets a member move monthly→yearly — with `membershipAccess`
still the only thing that decides access.
