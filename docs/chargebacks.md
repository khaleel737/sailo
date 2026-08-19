# Chargebacks

What Sailo records, what it sends to answer a dispute, and what it does about a
shop producing them.

Written against the code as it is: `packages/core/src/disputes`,
`packages/payments/src/disputes`, `packages/commerce/src/disputes`,
`apps/web/src/lib/stripe-webhooks/disputes.ts`, and the two surfaces at
`/hq/disputes` and `/admin/payments`.

Everything asserted about Stripe's behaviour below was verified against the live
API in test mode on **17 August 2026**, not read off the documentation, and the
evidence file limits were re-measured on **19 August 2026** for spec 45 — §10.
Where the two disagreed, the API won and the discrepancy is noted.

---

## 1. The one distinction everything rests on

`charge.dispute.created` fires for two completely different events, and Stripe
gives them the same event name.

| | Inquiry (retrieval) | Chargeback |
| --- | --- | --- |
| Test method | `pm_card_createDisputeInquiry` | `pm_card_createDispute` |
| `status` | `warning_needs_response` | `needs_response` |
| `payment_method_details.card.case_type` | `inquiry` | `chargeback` |
| `network_reason_code` (Visa fraud) | `10` | `10.4` |
| `balance_transactions` | `[]` | one entry |
| Money moved | **none** | `net: -5700` on a $42 charge |
| `is_charge_refundable` | `true` | `false` |

An inquiry is the issuer asking a question on the cardholder's behalf. Nothing
has been debited, nothing is owed, and answering it well usually stops it
becoming a chargeback. A chargeback has already taken the money.

**Sailo's first implementation treated them alike**, which produced three
failures, each of which cost real money:

1. An inquiry marked the order `disputed`, telling a seller their money had gone
   when it had not — in a status `SELLER_SETTABLE_PAYMENT_STATUSES` deliberately
   forbids them from correcting.
2. `warning_closed` — an inquiry closing with no chargeback behind it, which is
   the *good* outcome — took the losing branch, because the branch was
   `status !== "won"`. The order was marked refunded, its stock went back on the
   shelf and the affiliate's commission was reversed, on a sale the seller had
   been paid for and still held.
3. Counted into a ratio, inquiries roughly double it. Neither Visa's VAMP nor
   Mastercard's MMP counts them.

`isInquiry` in `core/disputes/lifecycle.ts` is the test, and it keys on the
`warning_` status prefix rather than on `case_type` — `case_type` lives under
`payment_method_details.card` and is absent on every non-card dispute.

## 2. What a chargeback actually costs

**$42 + $15 = $57.** `dispute.amount` is 4200; the balance transaction reports
`fee: 1500` (`fee_details[0].description = "Dispute fee"`) and `net: -5700`.

A seller shown `dispute.amount` is being told their loss is 36% smaller than it
was, and will reconcile their bank against a number that does not match. Both
surfaces show the deduction; `disputes.deducted_cents` stores it.

One consequence worth stating plainly, because it is the opposite of the refund
path: **the platform fee is not returned on a dispute.** Verified — the
`application_fee` object still reads `refunded: false, amount_refunded: 0` after
the chargeback lands. A refund issued through `refundCharge` sets
`refund_application_fee: true` and returns Sailo's cut proportionally; a lost
chargeback does not. The seller loses $57 and Sailo keeps $0.84.

That is Stripe's behaviour rather than a choice Sailo made, and it is not
obviously the right one. It is recorded here because nobody would find it
otherwise.

## 3. The five events, and why two of them are not optional

`HANDLED` in `payments/src/stripe/verify.ts` carries all five plus the Radar
warning. Three were added in this pass and none is a refinement:

- **`charge.dispute.updated`** is how `enhanced_eligibility_types` changes. Visa
  decides whether a fraud case qualifies for Compelling Evidence 3.0 *after* the
  dispute is created, and that decision arrives here. Without it, the one
  mechanism that can win a 10.4 outright is never known to be available.
- **`charge.dispute.funds_withdrawn`** and **`.funds_reinstated`** carry the
  balance transaction, which is the only place the real cost appears.
- **`radar.early_fraud_warning.created`** is the only advance notice of a
  chargeback that exists — see §7.

All five describe one dispute under five different event ids, so the
`stripe_events` claim in the webhook route does not de-duplicate them.
`disputes_stripe_id_key` does: one row per Stripe dispute, decided by Postgres.
Five rows would be a dispute rate five times its real value, which would hold a
seller's payouts for arithmetic.

Out-of-order delivery is handled by `acceptsStatusChange`: a closed dispute
accepts nothing but another closed status, so a retry of an earlier event cannot
reopen a decided case.

## 4. The evidence, and what actually wins each reason

The networks do not judge a rebuttal on how convincing it reads. They judge it on
whether specific named fields are present, and each reason code has its own list.
`core/disputes/reasons.ts` holds the mapping as data.

| Stripe reason | Visa | MC | What decides it |
| --- | --- | --- | --- |
| `fraudulent` | 10.4 | 4837 | Identity + delivery. **CE3.0 beats all of it** — §5 |
| `unrecognized` | 10.4 | 4837 | Usually a statement-descriptor problem. Receipt first |
| `product_not_received` | 13.1 | 4855 | Proof of delivery. A tracking number showing "in transit" is not delivery |
| `product_unacceptable` | 13.3 | 4853 | The listing as it stood, and the disclosed returns policy |
| `credit_not_processed` | 13.6 | 4860 | If the refund went out, show it and stop |
| `duplicate` | 12.6 | 4834 | Name the other charge. A real duplicate should be refunded, not contested |
| `subscription_canceled` | 13.2 | 4841 | Continued use after the claimed cancellation date |
| `general` | — | — | No category means no target: send everything in one narrative |
| `noncompliant` | — | — | A compliance case. Contesting a Visa one costs **$500**, refunded only on a win |
| bank-rail returns | — | — | **Not answerable.** Re-invoice — see below |

Two branches matter more than the reason code:

**What was sold.** "It never arrived" is answered with a carrier's proof of
delivery for a parcel, a download log for a file, and an attendance record for an
appointment. Submitting a tracking number for a download is submitting nothing.

**Whether it is a card dispute at all.** `bank_cannot_process`, `check_returned`,
`debit_not_authorized`, `incorrect_account_details` and `insufficient_funds`
arrive through the same webhook and the same `Dispute` object, and none of the
card evidence applies: there is no issuer to persuade, because the payer's own
bank returned the debit. A seller handed a "gather your proof of delivery"
checklist for one of those is being sent to do work that cannot change the
outcome.

### The limits, enforced before the API sees them

- **150,000 characters** across all text fields combined is Stripe's ceiling.
  Sailo's own budget is **20,000**, deliberately far below it: Stripe's guidance
  is that issuers review thousands of responses a day and that burying the
  argument loses cases a shorter one wins. Nothing assembled here comes close to
  either number, so the budget bounds a pathological order rather than tracking
  an API limit. Over Stripe's figure the *entire* update is rejected, losing the
  fields that were right along with the one that overflowed;
  `assembleEvidence` spends the budget in playbook order, so a submission that
  has to be trimmed keeps what the network reads.
- **4.5 MB across every document on the dispute**, and under 50 pages — 19 on
  Mastercard. Combined, not per file, which is the part no upload form expresses
  on its own: a 4 MB proof of delivery leaves no room for a 600 KB receipt, and
  the upload that tips the set over is refused at the deadline. `acceptEvidenceFile`
  takes the whole set and answers against it, and the bytes of a document being
  *replaced* come back out of the budget so that compressing a scan is never the
  thing that gets refused.
- **PDF, JPEG or PNG only**, and Stripe parses the file rather than trusting the
  declared type — a corrupt export is refused with "the file you uploaded is not
  supported". The type is checked against the content type before the bytes
  leave, because Stripe's Files API has **no delete**: a document uploaded and
  then rejected is a permanent orphan on the seller's own account.
- **One document per evidence field.** A second upload to
  `customer_communication` replaces the first rather than joining it, so a seller
  with three screenshots must combine them. Enforced by a unique index on
  `(dispute_id, field)` — without it one field becomes two rows, one of which is
  submitted and the other silently dropped, with nothing recording which.
- **Files are account-scoped.** A document uploaded to the platform is invalid in
  a connected account's `disputes.update`, which fails naming the *evidence
  field* rather than the account — so it reads as a broken assembler. Every
  upload carries the same `stripeAccount` as the dispute.
- **One submitted response per dispute.** `submit: true` is irreversible;
  `submit: false` stores a draft Stripe does nothing with. A platform that omits
  the flag has a pipeline that appears to work — `has_evidence: true` on every
  dispute — and wins nothing. The two are separate buttons in /hq.
- **`due_by` is epoch seconds.** Read as milliseconds, every deadline lands in
  1970 and renders as past due.

### Where a document is attached

Everything else in a submission is assembled server-side from rows Sailo already
holds. The nine **file** fields cannot be: a carrier's proof of delivery, a
signed receipt, a screenshot of a conversation exist only on somebody's computer.
They are the one place a dispute takes input from outside, so they are the one
place with an upload — and two surfaces have it:

- **`/hq/disputes/[id]`** — the chargeback desk. Shows every field of the
  submission, held or missing, in playbook order; whether Stripe will accept a
  response at all; whether CE3.0 applies and, if it does not, which of the rule's
  conditions failed. Staff can attach, replace and remove documents, and stage or
  send the answer. This is the screen that answers *what would be sent if I
  pressed Send* — the queue page cannot, because a row cannot hold thirty fields.
- **The seller's payments page** — the same component, ownership-checked instead
  of allowlist-checked, showing only the fields their own case wants. A seller is
  never shown a rate (see §6); they are shown the deadline and the document.

Both write to `dispute_evidence_files`, and `respondToDispute` reads that table
at the moment of sending. Uploads stop being accepted once the answer has gone:
Stripe reads one response per dispute, so a seller allowed to attach afterwards
is being told they supplied what was missing on a case that is already decided.

**The upload is a route handler, not a server action** —
`POST /api/disputes/[id]/evidence`. Server actions cap the request body at
**1 MB** by default and evidence runs to 4.5 MB, so the obvious implementation
works for every document small enough not to matter and fails on the scanned
proof of delivery that decides the case — as a framework error, which no code
here could word helpfully. Raising `serverActions.bodySizeLimit` would fix it by
widening the body limit for every action in the app, which is a DoS trade made on
behalf of code that never asked for it; `/api/upload` already set the precedent
that large writes here are routes with their own auth and rate limit. *Removing*
a document stays a server action, because it posts two short strings.

Both routes and both actions authorise through `lib/dispute-access.ts`. Two entry
points to one capability must not be two answers to "may you?" — and the preview
(`GET /api/disputes/[id]/evidence/[field]`, which mints a 30-minute Stripe
`FileLink` and redirects) is the more dangerous of the two, not the less: a
document on a dispute names a buyer, their address and what they bought.

The combined ceiling is checked twice — once per upload against what is held, and
again in `respondToDispute` against the final set. The second exists because two
people attaching to different fields at the same moment can each be told yes and
jointly land over 4.5 MB; without it, that becomes Stripe rejecting the whole
update at the point somebody is pressing Send with a deadline in hours.

Note what is *not* here. A seller cannot edit the text of a submission. A browser
that could post `shipping_date` is a browser that could post a date nobody
shipped on, into a document that goes to a bank — so the text is assembled from
the order every time, and files are the sole exception because they are bytes
rather than claims.

## 5. Visa Compelling Evidence 3.0

The only mechanism here that resolves a dispute *without* an issuer weighing
anything, and it applies to the reason code a small shop is least able to answer
and most likely to receive.

**The rule.** A merchant who can show two prior undisputed transactions by the
same cardholder, between 120 and 365 days before the disputed one, sharing at
least two identifying data points, wins a 10.4 pre-arbitration outright — on the
reasoning that a stranger who stole a card does not shop somewhere three times
over four months.

**The data points** Visa will match on: account id, device fingerprint, device
id, email, purchase IP, shipping address.

**The consequence nobody plans for.** The two prior transactions must *already*
carry the data points. A platform that starts recording IP addresses today cannot
use CE3.0 for another four months, and cannot backfill: the buyer's connection
existed for the length of one request. That is the argument for `orders.buyer_ip`
being a one-line change made now rather than a feature scheduled later, and it is
why `/hq/disputes` reports **defensible orders** as a headline figure.

**Two traps in the implementation**, both of which fail silently:

- `prior_undisputed_transactions[].charge` wants a `ch_…`. `orders` stores a
  `pi_…`. Stripe does not coerce; the field is rejected and the rejection takes
  the whole `disputes.update` with it, losing the ordinary evidence that was
  correct. `chargeIdForIntent` is the conversion.
- Matching two nulls is not a match. `a.purchaseIp === b.purchaseIp` is `true`
  when both are null, so a naive comparison of two orders that recorded nothing
  "matches" on all six points and submits a claim with no basis.

`selectPriors` picks the pair with the *most* matching points rather than the two
most recent, because Visa checks the pair it is given rather than looking for a
better one.

## 5.5 Telling the seller

Everything above is reachable only by somebody who knows the case exists. Until
this pass nothing told them: the dispute was recorded, the order moved, /hq lit
up, and the seller found out on their next visit to the payments page. The window
is around twenty days and the evidence that wins is usually a document only they
have, so a seller who does not log in loses by default — not because the case was
weak, but because nobody sent the proof of delivery.

Four messages, and each is sent **exactly once**:

| When | Sent from | Says |
| --- | --- | --- |
| The case opens | the dispute webhook | What went, what is left, and the one document still needed |
| Four days out | `/api/cron/disputes`, hourly | The same ask, with the clock |
| It closes | the dispute webhook | Won, lost, or closed without a chargeback |
| An early fraud warning | the EFW webhook | Refund now and avoid the chargeback *and* its fee |

The last one is the only message in the product that can prevent a chargeback
rather than answer one, which is why it exists at all.

**Idempotent by claim, not by check.** Stripe delivers at least once and one
dispute arrives under several event ids, so each send is claimed with a single
conditional update — `set seller_opened_notified_at = now() where … is null
returning id` — and only the caller that gets a row back sends. Two deliveries
racing produce one email, decided by Postgres; a read-then-send produces two. The
claim is *released* if the mail provider fails, so an outage delays a notice
rather than silencing it forever.

**No notification preference, deliberately.** `wantsNotification` gates order
mail. This is not order mail: it is money leaving a balance inside a legal
window, and a seller who muted "order placed" two years ago has not consented to
losing £400 unannounced. `sendSellerWebhookDisabled` set the same precedent.
Turning it off is a support conversation, not a checkbox about receipts.

**Its own ceiling.** Sharing the `seller-mail:` bucket would let a burst of order
mail — or a bug in it — suppress the most important message Sailo sends.

**Never a rate.** A seller cannot act on a ratio, and one they are near reads as
a threat from their own software. Deadlines and documents are actionable; the
rate is /hq's business (§6). `disputes.test.ts` asserts the words never appear.

Awaited inside the webhook rather than deferred with `after()`, which is the same
call `connect.ts` makes and for the same reason: a webhook is not a request
somebody is waiting on, and `after()` would race the function shutting down.

## 6. Measuring a shop

Three questions with three different denominators. Conflating the first two is
the standard error in chargeback monitoring, and it fails in the one direction
you cannot afford.

### 6.1 Cohort rate — is this shop a problem?

Disputes are attributed to the month **the order was placed**, never the month
the dispute arrived.

Disputes arrive 60–120 days after the sale. A seller running genuine 6% fraud
while tripling volume each month has their May disputes divided by their August
orders, and reads as clean. The faster they grow, the better they look, and
growth is what a fraud ring does.

The numbers, from `disputes.scenario.ts`:

> 100 orders five months ago carrying 6 chargebacks, then 900 clean orders this
> month. The disputes all arrive now.
>
> - arrival-month: 6 / 1000 = **60bp** — under the review threshold. Clean.
> - cohort: 6 / 100 = **600bp** — over the payout-hold threshold.
>
> Same six disputes, same shop, same day.

Two further corrections to the denominator, each worth roughly a third of the
answer:

- **Unpaid orders are excluded.** A third of card sessions are abandoned.
- **Cash orders are excluded.** A shop with 900 cash-on-delivery orders and 100
  card orders with 3 chargebacks has a 3% card rate, not 0.3% — and the shops
  most affected are the ones selling into cash markets.

Immature cohorts are excluded from *both* sides, so a shop cannot dilute a bad
history by launching a big month.

### 6.2 Floors — a rate needs a minimum before it may act

| Rung | Chargebacks | Settled orders |
| --- | --- | --- |
| Review | 2 | 25 |
| Payout hold | 3 | 50 |

Both sides are floored and the numerator floor does the work. One dispute on
three orders is 33% and evidence of nothing; a denominator floor alone still lets
a single chargeback on the twenty-sixth order trip a threshold. This is
Mastercard's own shape — 100 chargebacks **and** 1.5% — scaled to shops that sell
in tens rather than tens of thousands.

The failure being designed against is precise: **suspending hobbyists while
missing professionals.** A professional at 3% on 2,000 orders clears every floor;
a florist with one angry customer clears none.

`ratioBp` returns `null` rather than a number below the floor. Null cannot be
sorted, charted, or compared to a threshold by code written a year from now.

### 6.3 Counts, where a rate is impossible

Two populations have no usable denominator and are counted instead:

- **Immature cohorts** — orders too recent for their disputes to have arrived. A
  three-week-old shop with four chargebacks has no measurable rate and needs
  looking at immediately.
- **Unattributed disputes** — chargebacks on charges with no Sailo order, which a
  seller taking payments from Stripe's own dashboard produces. Until a live run
  found it these were counted *nowhere*: the cohort query joins from `orders`, so
  a dispute with no order simply did not appear, and a shop could run 20% fraud
  outside its own checkout and read as clean.

Both feed `emergingChargebacks`; three of either is worth a human's attention.

### 6.4 Network ratios — are *we* about to be fined?

The one place an arrival-month count is correct, because it is the sum Visa and
Mastercard actually compute. Shown on `/hq/disputes` and never mixed with the
per-shop rate.

| Programme | Threshold | Minimum | Denominator |
| --- | --- | --- | --- |
| Visa VAMP, above standard | 0.9% (from Jan 2026; was 1.5%) | 1,000 | same month |
| Mastercard MMP, excessive | 1.5% | 100 | **previous month** |
| Mastercard MMP, high excessive | 3.0% | 300 | **previous month** |

Mastercard's previous-month denominator is not a detail: a shop that halves its
volume sees its Mastercard ratio double with no change in behaviour.

**These figures need confirming with Stripe before being relied on.** They are
carried in `NETWORK_PROGRAMMES` with `needsConfirmation: true` and a source line,
and the /hq page says so on screen. Two of them moved on 1 January 2026.

Sailo's own thresholds sit deliberately below all of them — review at **0.75%**,
payout hold at **1.5%**, per shop. The review threshold was 1.0% in the first
draft and that was wrong in a way worth recording: it put Sailo's first look
*after* the point at which a shop had already taken the platform over Visa's own
merchant threshold. A control whose first alarm fires once you are in breach is a
reporting tool. `rate.test.ts` asserts the ordering.

## 7. Early fraud warnings

Radar reports the issuer's TC40/SAFE fraud notice days before the dispute
arrives. Refunding in that window avoids the chargeback and the $15 fee.

It does **not** keep a rate clean: the fraud report still counts towards Visa's
VAMP fraud component whether or not the charge is refunded. So this is a way to
stop losing the goods as well as the money, and a shop generating warnings is a
shop with a problem before any dispute has landed.

Deliberately not automatic. An EFW is the issuer's opinion, not a finding, and
auto-refunding every one would hand money back on legitimate sales already
shipped.

## 8. What happens to a shop, and in what order

The instinct is to close the storefront, and it is the wrong first move on both
counts: it does not protect the money — the exposure is the balance about to be
paid out, not the sales that have not happened — and it is not reversible in the
way that matters. A seller whose shop went dark for a day has told their
customers something about Sailo that clearing a flag does not untell.

| Rung | What happens | Applied by |
| --- | --- | --- |
| `watch` | A number moves in /hq | code |
| `review` | A human is asked to look. Nothing happens to the seller | code |
| `payout_hold` | Payouts switch to manual | code |
| `suspend` | The storefront closes | **a person, only** |

`assessShop` cannot return `suspend`, `applyEscalation` refuses it a second time,
and `escalation.test.ts` asserts it exhaustively across every combination of
facts. Closing a shop is a judgement about whether this is a fraud ring or a
seller who had a terrible month, and the cost of being wrong falls entirely on a
real business.

### The payout hold

`settings.payouts.schedule.interval = "manual"`, and the two obvious
implementations are both wrong: `payouts_enabled` is read-only, and revoking the
`transfers` capability would stop the account receiving charges too.

Under the schedule change, `payouts_enabled` stays `true`. The shop keeps
selling, keeps taking card payments and keeps accruing a balance a chargeback can
still be debited from — the money simply stays in the seller's own Stripe account
instead of leaving on the next run. One update back to their previous interval
reverses it, and `payout_interval_before_hold` remembers what that was so a
weekly-payout seller is not silently moved to daily.

Held by arithmetic, **released by a person**. The arithmetic that would lift a
hold is the same arithmetic that lifts it the moment a shop's oldest cohort ages
out of the twelve-month window, which returns a fraudulent seller's payouts on a
calendar technicality with nobody having looked.

A staff clearance is overridden by two further chargebacks rather than by time —
new evidence, not the passage of days — because a check that re-flags what was
just cleared is a check everybody learns to ignore.

### Exposure, which is not a ratio

Sailo runs direct charges on Express accounts, making
`controller.losses.payments = application`: the platform is the losses collector.
A chargeback debits the *seller's* balance, and if it cannot cover it the account
goes negative — after 180 negative days Stripe takes the shortfall from Sailo's
reserve (`payments-compliance.md` §3.2).

So the money at risk is what the open disputes exceed the balance by, and payouts
are held at a **$250** shortfall regardless of any rate. Below that the exposure
is smaller than the cost of a false positive: a held payout is a seller who
cannot pay their own supplier.

**It is a `max`, not a sum**, and a live run is what proved it. A real $600
chargeback on an otherwise empty account produced: open disputes $615, available
balance $0, negative balance $615 — and a reported exposure of **$1,230**. The
two figures are the same money seen twice, because Stripe debits the balance when
the chargeback lands, which is what made it negative.

## 9. Running the tests

```bash
# Pure logic. No database, no Stripe. 163 tests.
npx vitest run --root packages/core src/disputes

# Against real rows: the handlers, the cohort SQL, the ladder, both panels.
./e2e/scenarios/up.sh                      # or point at a dev branch, below
npx dotenv -e ../../.env.local.test -- \
  npx vitest run --config vitest.scenarios.mts e2e/scenarios/disputes.scenario.ts

# The documents: the upload route, its authorisation, the ceiling, the
# replacement rule, and whether an upload actually closes the gap on both
# panels. Stripe stubbed at the seam.
npx dotenv -e ../../.env.local.test -- \
  npx vitest run --config vitest.scenarios.mts e2e/scenarios/dispute-files.scenario.ts

# The seller's mail: who is told, once, about what — including two deliveries
# racing for the same claim.
npx dotenv -e ../../.env.local.test -- \
  npx vitest run --config vitest.scenarios.mts e2e/scenarios/dispute-notices.scenario.ts

# The messages themselves, rendered. `EMAIL_PREVIEW_DIR` also writes every one
# to HTML for a person to look at.
npx vitest run --root packages/email src/shop/disputes.test.ts

# Against real Stripe. Creates real test-mode disputes on the account.
STRIPE_CONNECT_ACCOUNT=acct_… npx dotenv -e ../../.env.local.test -e ../../.env.local -- \
  npx vitest run --config vitest.scenarios.mts e2e/scenarios/disputes-live.scenario.ts
```

The scenario suites refuse to run against the database the app is configured
with. A local container always passes; a remote branch needs
`SCENARIO_ALLOW_REMOTE` **and** a URL that differs from `.env.local`'s — which is
a stronger test than "must be localhost", because the failure being prevented is
"wrote to the database serving customers" rather than "wrote to a remote host".

Both suites purge their own fixtures on start. Without that, a persistent branch
accumulates: after a handful of runs it held 10,485 orders and the cohort queries
began timing out, which looks like the feature being slow rather than the
fixtures never being cleared.

### Driving it by hand

```bash
stripe listen \
  --forward-to         http://localhost:3100/api/stripe/webhook \
  --forward-connect-to http://localhost:3100/api/stripe/connect/webhook

# A chargeback on a connected account
stripe payment_intents create --stripe-account acct_… \
  -d amount=4200 -d currency=usd -d payment_method=pm_card_createDispute \
  -d confirm=true -d off_session=true -d application_fee_amount=84

# An inquiry, for the other half of §1
stripe payment_intents create --stripe-account acct_… \
  -d amount=1900 -d currency=usd -d payment_method=pm_card_createDisputeInquiry \
  -d confirm=true -d off_session=true
```

`stripe trigger charge.dispute.created` produces an **inquiry**, not a
chargeback, which is worth knowing before concluding the chargeback path works.

## 10. The evidence file limits, measured

Spec 45 asked one question before the evidence pack was built — *"whether
attaching one Stripe file id to several evidence fields counts once or several
times against the combined cap … check it against the live API in test mode and
record what the API said, not what the docs say."* Measured on **19 August
2026**, on the platform account in test mode, against API version
`2026-07-29.dahlia`. Three of the four answers differ from the documentation.

### One file id on several fields is charged for each field

| Attachment | Bytes counted | Result |
| --- | --- | --- |
| `receipt = A` (3,607,988 B) | 3,607,988 | accepted |
| `receipt = A`, `uncategorized_file = A` — *the same id* | 7,215,976 | **refused** |

> Adding these files would bring the total evidence size over the 5 MB maximum.

So the conservative assumption was the correct one, and `bytesHeld` — which sums
`dispute_evidence_files` rows, one per field — already accounts for it. A
generator that attached one pack to three slots would be spending three times its
size.

### The combined ceiling is ~4.8 MB, not the 5 MB the error names

Binary-searched with two distinct files across two fields, a fresh dispute per
trial (`disputes.update` persists, so reusing one measures the sum of every trial
before it):

| Total | Result |
| --- | --- |
| 4,502,440 B | accepted |
| 4,699,288 B | accepted |
| 4,750,002 B | accepted |
| 4,799,134 B | **refused** |

`EVIDENCE_FILE_BUDGET_BYTES` is 4,500,000 — about 250 KB of headroom under the
line Stripe actually draws. That is the right direction: the constant exists to
refuse *before* the API does, because an overflow rejects the entire
`disputes.update` and loses the fields that were correct. Its comment used to
call 4.5 MB "Stripe's own limit"; it is a margin, and now says so.

### The 50-page limit is enforced, not advice

> The file you uploaded was too long. Please upload a file with fewer than 50
> pages.

A 400 from the Files API. Nothing reaches the evidence object. `PAGE_GUIDANCE`
described this as "carried as guidance rather than enforced", read off the
best-practices page.

It matters most for documents Sailo *generates*, where there is no seller to read
an error: a refused upload leaves `autoFillEvidence` with nothing to register and
the slot silently stays empty. **A pack built from a policy snapshot at
`POLICY_BODY_MAX` in short lines rendered to 98 pages.** Fixed at both ends —
`PACK_POLICY_LINE_CAP` bounds the common case at the source and states the
truncation on the page, and `MAX_PACK_PAGES` in the renderer is a hard ceiling
for every other case.

### And two smaller ones

**The per-file limit is 5 MB**, separately from the combined budget: *"The file
you uploaded was too large. Please upload a file smaller than 5 MB."*

**Stripe validates file content, not the extension.** A hand-assembled
`application/pdf` that is not a real PDF is refused — *"The file you uploaded is
not supported"* — which is the same reasoning `EVIDENCE_FILE_TYPES` gives for
checking the content type rather than the filename, confirmed from the other
side.

### The fixed pack, end to end

Not a synthetic file this time — the pack the renderer actually produces, pushed
through the whole chain against the live API:

| Pack | Pages | Bytes | `files.create` | `disputes.update` |
| --- | --- | --- | --- | --- |
| Ordinary order | 1 | 4,765 | accepted, `type: pdf` | staged, `has_evidence: true` |
| 6,000-clause policy — the 98-page case | **11** | 16,480 | accepted | staged, `has_evidence: true` |

The second row is the one that matters: the same input that rendered 98 pages and
would have been refused now renders eleven and attaches. Both landed on a real
`du_…` created with `pm_card_createDispute`, with `submit: false`, leaving
`submission_count` at `0` — which is also `autoFillEvidence`'s contract, since a
pack registered at dispute-open must never spend the one submission.

Two figures worth keeping: a real pack is **kilobytes**, not megabytes, so the
4.5 MB budget is never the binding constraint on Sailo's own documents — the page
count was, and only for pathological policies.

### Method

`pm_card_createDispute` on a $42 PaymentIntent, exactly as §1, then
`files.create({ purpose: "dispute_evidence" })` and `disputes.update(…, { submit:
false })`. Padding a PDF to a target size needs vector paths rather than text:
`doc.text()` auto-paginates, so "45 pages of 60 lines" silently became hundreds
of pages and hit the page ceiling instead of the size one.

---

## 11. Sailo's own disputes, on the platform account

Spec 46 answers a chargeback against Sailo's own subscription revenue. Three
things it relies on, verified the same day:

**`accounts.retrieveCurrent()` is the right call, and the descriptor is at
`settings.payments.statement_descriptor`.** `accounts.retrieve(id)` wants a
connected account id and there is none to pass — the key *is* the identity.

**The platform descriptor cannot be set through the API.** The deploy step was
written to set it. It cannot; three shapes were tried and all three were refused:

| Call | Account | Refusal |
|---|---|---|
| `accounts.update(ownId, …)` | sandbox `acct_1U0kWG…` | "You cannot use this method on your own account: you may only use it on connected accounts." |
| `POST /v1/accounts/{ownId}` | platform `acct_1U0kW3…` | "Only live keys can access this method." |
| `POST /v1/account` | platform `acct_1U0kW3…` | "Only live keys can access this method." |

stripe-node says so in advance, in its own doc comment on `update`: *"To update
your own account, use the Dashboard."* There is no `updateCurrent` beside
`retrieveCurrent`. So the deploy step now **checks and reports** — it prints the
Dashboard URL and the current value as a task for a human, and does not fail the
deploy, because a build that goes red on a setting no pipeline can change is a
build people learn to ignore.

**What that changed in the evidence.** `platformHoldingsFor` used to fill
`statementDescriptor` from the `PLATFORM_STATEMENT_DESCRIPTOR` constant, so the
pack asserted *"the charge appeared on the statement as SAILO"* on the strength
of a string literal. Since the value is only ever set by hand in a Dashboard,
that claim was one forgotten setting away from being false — and the sandbox
proved it, reading `SAILO SANDBOX` while the constant said `SAILO`. It is now
read from the live account and cached, and a read failure prints no line at all.
The platform account does read `SAILO`, so the claim was true in production; it
was true by luck rather than by construction, which for a statement made to an
issuer is not the same thing.

**Every evidence field `assemblePlatformEvidence` emits exists.** All fourteen —
`access_activity_log`, `billing_address`, `cancellation_policy_disclosure`,
`cancellation_rebuttal`, `customer_email_address`, `customer_name`,
`customer_purchase_ip`, `duplicate_charge_explanation`, `duplicate_charge_id`,
`product_description`, `refund_policy_disclosure`, `refund_refusal_explanation`,
`service_date`, `uncategorized_text` — sent one at a time so a rejection would
name the field. None was rejected. This matters because one bad name fails the
whole update and takes the correct fields with it.

**An unqualified CE3.0 payload costs the whole answer.** `respondToPlatformDispute`
declines to attempt Visa Compelling Evidence 3.0 and says why; the "why" is now
measured rather than reasoned. Sending
`enhanced_evidence.visa_compelling_evidence_3` alongside ordinary evidence on an
ineligible charge (`enhanced_eligibility_types: []`) was refused:

> Disputed transaction ch_… is not eligible for Visa Compelling Evidence 3.0.

And re-reading the dispute afterwards, `product_description` and
`uncategorized_text` — sent in the same call — were **both null**. The update is
all-or-nothing, so a speculative enhanced payload does not degrade to an ordinary
submission; it discards it. Qualify first or do not send it.

**A platform dispute takes no `stripeAccount` header.** `disputes.update` on the
platform account with `submit: false` staged the evidence: status stayed
`needs_response`, `evidence_details.submission_count` stayed `0`, and
`has_evidence` became `true`. That is the contract `respondToPlatformDispute`
depends on, and sending a connected-account header instead would 404 on somebody
else's account — a case answered with nothing. Carried through to the real thing
on a fresh dispute: the twelve-field platform payload staged, then `submit: true`
moved it `needs_response` → `under_review` with `submission_count` `0` → `1` and
every field still present.

---

## 12. Still open

| # | Item | Kind |
| --- | --- | --- |
| 1 | Confirm the VAMP and MMP figures in `NETWORK_PROGRAMMES` with Stripe | Business |
| 2 | `shops.stripe_account_id` is indexed but not unique. One account belongs to one shop and nothing enforces it; a partial unique index would take today. Not applied because the scenario suites share one account id across fixtures | Eng, small |
| 3 | The evidence assembly reads English. The same limitation as the restricted-business screen (`payments-compliance.md` §4.1) — a Polish shop's product description goes to the issuer in Polish, which is correct, but the narrative around it is English | Eng |
| 4 | Sailo's platform fee is not returned on a lost chargeback (§2). Whether it should be is a business decision nobody has made | Business |
| 5 | The combined evidence ceiling was measured to a 50 KB window (§10), not to the byte. Stripe's own message says 5 MB and the API refuses just under 4.8 MB, so something is counted that is not the file bytes — per-file overhead, most likely. `EVIDENCE_FILE_BUDGET_BYTES` clears it by 250 KB either way | Eng, small |

---

## Sources

- [Stripe: dispute categories and the network code map](https://docs.stripe.com/disputes/categories)
- [Stripe: respond to Visa Compelling Evidence 3.0](https://docs.stripe.com/disputes/responding)
- [Stripe: dispute evidence best practices](https://docs.stripe.com/disputes/best-practices) —
  what an issuer looks for in each file. **Its size and page table is not what the
  API enforces** — see §10 for the measurements that replaced it
- [Stripe: the File Upload API](https://docs.stripe.com/file-upload) — `purpose: dispute_evidence`
- [Stripe: early fraud warnings](https://docs.stripe.com/radar/early-fraud-warnings)
- [Stripe: manage payout schedules for connected accounts](https://docs.stripe.com/connect/manage-payout-schedule)
- [Visa Acquirer Monitoring Program (VAMP)](https://usa.visa.com/support/merchant.html) — thresholds changed 2025-04-01 and 2026-01-01
- Mastercard Merchant Monitoring Programme, from 2026-01-01 (replaced ECM)
- `stripe@22.5.0` type definitions, `cjs/resources/Disputes.d.ts` — the authority
  for every field name used here
