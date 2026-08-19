# Feature Specs — the build list

One file per feature, written to be handed to an agent cold. Each spec says
what the feature is, the exact tables and files involved, the edge cases
that will otherwise be missed, the tests that prove it, and a "done when".
Every "Sailo has / lacks" claim was verified in source during the
2026-08-10 gap analysis, not assumed.

**Everything in this folder is wanted.** Specs we decided not to pursue live
in `deferred/` and are not work — do not pick them up without the owner
saying so.

**Specs 30–43 are the Easytools parity release.** The analysis behind them —
their whole surface, ours, and the fourteen things we are deliberately *not*
building — is `GAP-2026-08-easytools.md`. The order, the gates and the two
decisions that block estimating are `RELEASE-PLAN-2026-08.md`. Read the gap
analysis before picking up any spec numbered 30 or above; several of them
narrow or supersede what came before.

## Rules for every agent, before any spec

1. **A schema change is not shipped until its migration has run against
   production.** Hand-write `drizzle/NNNN_<name>.sql`, apply to prod first,
   then push code. Green build/tests/types prove nothing about the database.
2. **Verification gate before every commit:** `npx tsc --noEmit` →
   `npx vitest run` → scenario suite (`./e2e/scenarios/up.sh` then
   `npx vitest run --config vitest.scenarios.mts`) → `npm run build` →
   `npx oxlint` → `npx knip`. Money-path changes need scenario coverage, not
   just unit tests.
3. **i18n is total.** Admin strings: keys in all 35 `src/i18n/admin/*.ts`.
   Storefront strings: all 35 `src/i18n/dictionaries/*.ts`. `en.ts` is the
   typed source; missing keys are compile errors — use that.
4. **Concurrent agents work in this tree.** Stage explicit paths only —
   never `git add -A`. Check `git status` before staging; leave others'
   files alone.
5. **Every public route carries a rate limit** (`rateLimit` /
   `refundRateLimit` in `src/lib/redis.ts`). Throttled is *unknown*, never a
   negative answer; budgets for guessing secrets charge misses, not
   lookups; no response may be an existence oracle.
6. **Money invariants:** claims are conditional UPDATEs (ceiling in the
   WHERE), webhooks are idempotent and ownership-checked
   (`src/lib/stripe-webhooks/ownership.ts` is the seam), ledger rows are
   append-only, order *lines* not order headers, blank ≠ zero.
7. **Check the six recurring bug shapes** (see auto-memory / PR history):
   half-updated function pairs, guard applied at one sink not its twin,
   check-then-act gaps, header-vs-lines, blank-vs-zero, throttled-as-no.
8. **Plan gating** goes through `src/lib/plans.ts` (`Features`/`Limits`,
   `can(shop, ...)`, `cheapestPlanWith`) with the existing upgrade-modal
   pattern. No silent caps — clamped or truncated output says so.
9. **Storefront caching:** public pages are `"use cache"` +
   `cacheTag(shopTag(shopId))`; any write that changes what a storefront
   shows must revalidate the tag.
10. **Never point write-tests at production.** The scenario stack refuses
    non-local databases; keep it that way in anything new.

## Build order

Work top to bottom unless the owner reorders. 01+02 ship together (one
Security tab).

| Order | Spec | Effort | Notes |
|---|---|---|---|
| 1 | `01-two-factor-authentication.md` | S | **Built** — plugin in `auth.ts`, `/verify-2fa`, per-user attempt ceiling |
| 2 | `02-login-sessions.md` | S | **Built** — Security tab lists, revokes (IDOR-guarded), signs out others |
| 3 | `03-account-deletion.md` | M | **Built** — password + typed handle, obligations refusal, ledger retained |
| 4 | `04-seller-notifications.md` | M | **Built** — `seller-messages.ts`, prefs card, once-per-order across rails |

### Checkout & revenue

| Order | Spec | Effort | Notes |
|---|---|---|---|
| 5 | `05-checkout-compliance.md` | S–M | **Built** — server-enforced terms, timestamped consent, in exports |
| 6 | `07-lead-capture.md` | M | **Next up** — not built; consent column (05) now exists |
| 7 | `06-recurring-memberships.md` | XL | **Built** — card *and* manual rails, `drizzle/0017`+`0018` |
| 8 | `08-order-bumps.md` | M | Not built |
| 8b | `28-shipping-zones.md` | M | **Built** — per-rate country zones, `drizzle/0019`; checkout country is a real list now |

| Order | Spec | Effort | Notes |
|---|---|---|---|
| 9 | `12-payout-visibility.md` | S | **Built** — `payout-card.tsx`, balance/payouts/requirements, cached |
| 10 | `11-analytics-upgrades.md` | S | **Built** — `product-performance.tsx`, plan-clamped ranges |
| 11 | `10-outbound-clicks.md` | S | **Built** — `clicks` table, beacon in track route, destinations chart |
| 12 | `09-marketing-pixels.md` | M | **Built** — validated IDs, storefront consent, scoped CSP |
| 13 | `13-refer-a-creator.md` | M–L | **Built** — see the growth note below |
| 14 | `22-onboarding-checklist.md` | S | **Built** — computed, no migration |
| 15 | `20-webinar.md` | M | **Built, reshaped** — see the bookings & audience note below |
| 16 | `17-booking-integrations.md` | L | **Built, reshaped** — iCal feed, not Google OAuth |
| 17 | `23-crm-upgrades.md` | M | **Built**, minus the seller phone field |
| 18 | `14-email-broadcasts.md` | L | **Built**, plus segments, promotions, scheduling and a signup page (`drizzle/0016`) — minus flows |
| 19 | `27-lifecycle-email.md` | M | **Built** — Sailo's own onboarding funnel to sellers |

### The bookings & audience block, as built

All four shipped as one release (`drizzle/0012`), shaped against what the
codebase already had rather than as the specs were written.

**`20-webinar.md`** needed no capacity model. Events already existed —
`kind: "event"`, capacity as ordinary stock, tickets, check-in — so what was
missing was the *online* half: `products.eventJoinUrl`, withheld until
`orders.downloadReleasedAt` exactly as a digital file is, and T-24h/T-1h
reminders. The reminder claim is a row in `event_reminders` with a unique
index on (order, product, lead), not a column on the order: a basket holding
two events must remind for both, which a `remindedAt` column cannot do.
*Not built:* replay delivery, one-click refund-all.

**`17-booking-integrations.md`** reads the seller's calendar from the secret
iCal address Google, Apple and Outlook each publish, rather than through
Google OAuth. Same read direction the spec called the one that matters, and it
reaches every provider instead of one — with no OAuth app, no provider
verification review, and no refresh tokens to keep at rest, so `TOKEN_SEAL_KEY`
and `GOOGLE_OAUTH_*` are not needed. Fetched under an SSRF guard with
hand-followed redirects, cached 60s, failing open to Sailo-only availability
exactly as specified. Subtraction happens at display time only; the write-time
guard is still the exclusion constraint. *Not built:* the write direction
(Sailo bookings into the seller's calendar) and Zoom auto-meetings — both
still want OAuth.

**`23-crm-upgrades.md`** shipped tags (`clients.tags`, GIN-indexed, filtered
in the WHERE), manual contacts, CSV import, and server-side order filters.
*Not built:* the seller's own phone field — display-only, with no reader.

**`14-email-broadcasts.md`** shipped whole, including the legal floor:
consent-only audiences, RFC 8058 one-click unsubscribe (POST at
`/api/unsubscribe/[token]`, confirm page at `/u/[token]`, and a GET that
deliberately unsubscribes nobody), bounce and complaint suppression from a
signature-verified Resend webhook, and per-shop plus platform-wide daily
quotas. *Not built:* flows, scheduled sends.

New environment variables: `RESEND_WEBHOOK_SECRET` (the bounce webhook refuses
to run without it) and the optional `BROADCAST_DAILY_CEILING`. Unsubscribe
tokens are signed with a key *derived* from `BETTER_AUTH_SECRET`, so they need
no new secret and cannot be confused with anything the auth library signs.

**The second release (`drizzle/0016`)** answered the two things v1 could not
do: address anybody but "everyone" or "one tag", and grow a list at all.

*Segments.* `broadcasts.audience_filter` is a jsonb question rather than a
member list, re-asked at queue time — nineteen rule types across who a contact
is, what they bought and what they have done, each a correlated EXISTS ANDed
onto the consent floor rather than a filter applied after it. `segments.ts`
holds the vocabulary, parsing and wording and is import-safe in the browser;
`segment-sql.ts` holds the SQL and is not. v1's `audience_tag` is still read
when the filter is null, so a past send keeps describing the audience it
actually went to. "Bought this" asks the order *lines* and the header both —
pre-cart orders have no lines, and those are a shop's oldest customers.

*Promotions.* A broadcast can carry a coupon, up to four product cards and one
button; all three are references resolved at send time, so a price or expiry
edited mid-send reaches the batches still to leave. The markdown pipeline moved
to `markdown.ts` — every emitted tag now carries inline styling (a bare `<p>`
is 16px Times in Gmail), images are https-only and width-capped, and merge tags
are substituted into the finished HTML, escaped, so a customer named `**Ann**`
cannot render bold.

*Scheduling.* `status = 'scheduled'` with `scheduled_at`; the existing queue
cron promotes what is due through the same claim the Send button uses, and
re-checks the plan first — a seller who scheduled six weeks and then
downgraded gets their drafts back, not their sends.

*The signup page.* `/[handle]/subscribe`, plus an optional card under the
storefront's products. Double opt-in and nothing written until the link is
clicked: the form reads no rows, so it cannot become an address checker, and
its answer is one sentence whether the address was new, known or blocked. A
confirmed opt-in is the only thing that lifts an `unsubscribed` suppression —
never a `bounced` or `complained` one. Signup tokens expire after seven days
and are signed under their own domain string, so they cannot be swapped with
unsubscribe tokens in either direction. *Not built:* flows.

### Recurring memberships, as built

**`06-recurring-memberships.md`** shipped as specified, on the Connect side:
`mode: "subscription"` Checkout Sessions on the seller's own account, with
Sailo's cut as `application_fee_percent` (derived from `platformFeeBp`, so a
membership and a one-time sale can never drift onto two fee policies).

`products` gained `billingInterval`, `trialDays` and a cached Stripe Price —
a Price is immutable, so a re-priced membership mints a new one and existing
members stay where they signed up. The staleness check compares the *interval*
as well as the amount: £30 monthly and £30 yearly are the same number, and an
amount-only check would go on billing monthly for something now sold annually.

`subscriptions` is the access source of truth and Stripe is the billing source
of truth; the webhook reconciles them and nothing here computes an amount.
Every paid invoice writes an ordinary order, so Income, the CSV export and the
invoice sequence needed no changes — with a partial unique index on
`stripe_invoice_id` so the same invoice under two event ids cannot record a
month of revenue twice.

Three things the scenario suite caught that reading did not. `ON CONFLICT`
cannot infer a *partial* unique index without repeating its predicate, so every
renewal failed outright until the `where` was added. `customer.subscription.*`
can arrive before the checkout session that caused it, so the signup order is
linked from every path that learns about a subscription rather than only from
the session — otherwise the first payment was recorded as a renewal and the
signup sat unpaid for ever. And the 24-hour abandoned-checkout sweep would have
cancelled a trialling member's signup order mid-trial, so `membership` is
exempt from it.

Access is decided at *download* time, never at token-mint time, with grace to
`currentPeriodEnd`: a cancelled member keeps the month they paid for, and
`past_due` stays open while Stripe retries a card rather than locking somebody
out over their bank's fraud check. Cancellation is Stripe's — `cancel_at_period_end`
from the seller's members list, and Stripe's own billing portal from the
member's delivery page — so a button can never say "cancelled" while the card
keeps being charged.

**Memberships on every rail (`drizzle/0018`).** The spec assumed card-only, and
that was too narrow: a gym taking cash at the door, a class settling by bank
transfer and a club arranging everything over WhatsApp all have members, and
none of them can take a recurring card payment. What makes something a
membership is that it *renews*, not that the renewal is automatic.

So `subscriptions.billing_mode` picks who runs the cycle. On `stripe` it is
Stripe, unchanged. On `manual` it is Sailo: a daily cron raises the next
period's order five days before the current one lapses, emails the member with
the shop's own payment instructions, and the seller marking that order paid —
the same dropdown they use for every other manual order — is what extends the
membership. The lead is five days because a transfer takes days to arrive and
the seller then has to see it.

Nothing about *access* forked. `membershipAccess` reads `status` and
`current_period_end` and has never known who wrote them, which is why the
grace rule, the members list, the download gate and cancellation all needed no
second implementation. The one deliberate asymmetry is grace: a `past_due`
card member keeps access while Stripe retries, and a manual one does not,
because nothing is retrying.

Idempotency without a webhook to lean on: `orders.membership_period_end`
records which period a payment bought, claimed in a conditional UPDATE, so a
seller toggling an order paid → unpaid → paid buys one month rather than
three. And `subscriptions.renewal_ordered_for` is claimed against the period
end, so overlapping cron ticks ask a member once.

Two traps worth remembering. The unique index on `stripe_subscription_id` was
briefly made *partial* when the column became nullable — which broke every
card membership write with `42P10`, because `ON CONFLICT` cannot infer a
partial index unless the upsert repeats its predicate. It is plain again;
Postgres already allows many NULLs. And the branch creating the manual
subscription was missing from `createOrderIntent` for a while, so every
membership still routed to Stripe: the scenario tests all passed because they
called the renewal module directly, and only lint caught it. There is now a
test that goes through the real checkout action.

*Not built:* free trials on manual rails — `trial_period_days` is Stripe's and
nothing else reads it, so a trial set on a cash or transfer membership does
nothing. The product form says so beside the field rather than leaving it
silent; making it real means the signup order being zero-value and the first
paid period being raised when the trial ends, which is a money-path change
worth doing on its own.

Also not built: proration UI, plan switching, seats/quantities, and coupons on
memberships (refused with a message rather than silently ignored — Stripe's
subscription discounts are their own system with their own duration rules).

### Member passes, as built (`drizzle/0027`)

Memberships were billing-complete and access-empty. `membershipAccess` had
exactly one caller — the download gate — so a membership could say whether
somebody had paid and never whether they may walk in. That is the whole
product for a gym, a class studio or a co-working desk, which is what people
actually sell as memberships.

`subscriptions.pass_code` is the member's credential and `member_checkins` is
the attendance. The pass is **not** a ticket and the difference is the design:
a ticket is one admission and burns itself `valid → used`, while a member
passes the same door ninety times a year, so the code is durable and every
scan re-asks the subscription. Entitlement is decided when the pass is
presented, never when it was minted — the same rule the download route
follows, and for the same reason: the code lives in a wallet for ever.

Nothing was rebuilt. The staff credential (`door_passes`), the scanner, the
guest list, the undo button and the offline replay are the ticketing ones, and
none of them learned what a membership is. `admitAnyCode` tries a ticket and
falls through to a pass only on `not_found`, which is unambiguous by
arithmetic rather than by luck: after folding, a ticket is ten characters and a
pass is twelve, so no string can be a candidate for both. There is a test that
fails if anyone ever shortens one to match the other.

Two rules that look small and are not. A member scanned twice is **green**,
where a ticket scanned twice is amber — the ticket case means somebody is
getting a second person in on one admission, the member case means the screen
lagged, and an amber screen would have a volunteer turn away a paid-up member.
And a ten-minute re-scan window means the second scan writes no row, so
attendance is not quietly inflated by a slow phone.

Minted on demand rather than at signup, and only for a membership somebody
turns up to (`serviceMode !== "online"`, the same switch `handedOverInPerson`
already reads) — a paid newsletter has no door, and a credential issued for one
is a live code to lose in exchange for nothing.

*Not built:* pause/freeze, attendance in the CSV export, and a scenario test —
the pure half is unit-tested but the claim and the live entitlement read want a
real database. **Correction, 2026-08-19:** weekly billing *is* built —
`BILLING_INTERVALS` now reads `day | week | month | year`, so the earlier note
here was stale. Pause/freeze is spec 49.

### Lifecycle email, as built

**`27-lifecycle-email.md`** is the other direction: Sailo mailing its own
sellers about getting set up, from `marketing@sailo.store`, on an hourly cron.
Twelve rungs anchored on real timestamps (signup, shop, first product, first
order) with eligibility re-checked at send time, so nobody is told to add a
product ten minutes after adding one. Every rung expires except `catch_up`,
which is the one honest thing to send a fleet that predates the feature — one
email that reads their current state and names where they actually stopped.

No stored funnel stage: the rung is derived from shops, products,
`payment_methods` and orders, exactly as the setup checklist derives its ticks.
The two tables are the *claim* (`lifecycle_emails`, unique on user+step) and the
platform-wide opt-out (`marketing_opt_outs`, keyed on the address so it outlives
the account). *Not built:* open/click tracking, A/B copy, a scheduling UI.

New environment variable: the optional `LIFECYCLE_DAILY_CEILING`. Marketing
opt-out tokens are signed under their own domain, so a broadcast token cannot
unsubscribe anybody from Sailo's own list, or the reverse.

### The growth block, as built

Two of the five shipped. What each one turned out to be, and why the other
three are gone:

**`13-refer-a-creator.md` — built.** `/r/<code>` → cookie → attribution at
shop creation → `invoice.paid` accrues 20% → `/hq/referrals` settles it by
hand. Every anti-abuse rule is a database constraint rather than a code path:
first-touch is `creator_referrals_referred_key`, self-referral is
`creator_referrals_not_self`, webhook idempotency is
`referral_earnings_invoice_kind_key`. Two departures from the spec, both
forced by what the code actually is:

- The spec attributes on `users`; Sailo attributes on **shops**, because a
  shop is what holds a plan and what `shopIdFor` resolves a Stripe customer
  to. One shop per user, so nothing is lost.
- The spec reverses refunds from `charge.refunded`'s `invoice` field, which
  **does not exist** in the pinned Stripe API version — an invoice's payments
  are their own objects now. The link is resolved with one
  `invoicePayments.list` call, and only on a refund that matched no order at
  all. See `handleSubscriptionRefund`.

  No card fingerprint check either: it would need a hash stored on the
  platform customer at subscribe time, which is a change to the billing path
  for the *hard* half of self-referral. The email check plus the constraint
  close the easy half; the rest is fraud review's.

**`22-onboarding-checklist.md` — built, as four steps not five.** "Publish
your shop" is not a step: `shops.isPublished` defaults to `true`, so it was
ticked from the moment a shop existed and would have opened every new seller
on 1/5 for doing nothing. "Share your link" is not one either — the dashboard
already leads with the link, copy button and all. Reasoning is in
`src/lib/onboarding.ts`.

**`15-landing-pages.md` — dropped.** Not Sailo's product direction. Moved to
`deferred/`.

**`21-media-embeds.md` — dropped.** It is written for an "external-link
product", and Sailo has no such kind: `products.kind` is
`physical | digital | service | event`. Its own spec says it exists to feed
15, which is gone. Moved to `deferred/`.

**`16-outbound-webhooks.md` — dropped from the growth block, not from the
build.** Signed events to Zapier are integration plumbing, not growth, and
they carry a security surface (request-time SSRF, a retry cron, a delivery
table to prune) that deserves its own pass rather than a corner of this one.
Left in place at the bottom of the list.

| Order | Spec | Effort | Notes |
|---|---|---|---|
| 19 | `16-outbound-webhooks.md` | M | **Built, widened** — webhooks *and* a REST API *and* an MCP server (`drizzle/0020`) |

### The integrations block, as built

**`16-outbound-webhooks.md` shipped, and grew two halves the spec assumed
would follow it.** A webhook that fires and cannot look anything up is half an
integration; an API with nothing to trigger it is the other half. Both are
behind one `integrations` feature flag on Business, and one credential opens
both — a seller who revokes a key revokes everything, which is what they will
expect.

*What is deliberately still absent: an app directory.* Zapier, n8n, Make,
Pipedream and everything behind them consume a plain signed POST, so the first
build reaches all of them. Each named connector would be an OAuth client, a
refresh token at rest and a support surface, per logo, forever — the same trade
`17-booking-integrations.md` refused when it chose iCal over Google OAuth.

**Signing is [Standard Webhooks](https://www.standardwebhooks.com), not the
Stripe scheme the spec named.** The spec's stated reason was "so consumers can
reuse verifiers", and this meets it better: Standard Webhooks has maintained
libraries in nine languages, so a consumer writes one line instead of
transcribing our recipe and getting the concatenation wrong. It is also what
Svix speaks, so moving behind Svix later would be invisible to every endpoint
already receiving. Three headers — `webhook-id`, `webhook-timestamp`,
`webhook-signature` — over `<id>.<timestamp>.<body>`, keyed on the *decoded*
bytes of the `whsec_`-prefixed secret.

**The SSRF guard is at connect time, and that is why it does not use `fetch`.**
The tempting shape — resolve, check, then fetch — has a hole exactly where the
spec warned: the check and the connection are two separate resolutions, and
whoever controls the domain answers the second with `169.254.169.254`.
`lib/webhooks/post.ts` uses `node:https` with a `lookup` hook, so the address
approved is the address connected to, with no window between them and TLS still
validating against the hostname. `lib/ip-ranges.ts` is the predicate, and it
unwraps IPv4-mapped, NAT64 and 6to4 IPv6 — `::ffff:169.254.169.254` is the
metadata endpoint written in a notation a prefix check waves straight through.
Redirects are never followed, the response body is capped and discarded, and
only 443 is allowed: arbitrary ports would make the test button a port scanner
with our IP on it.

**The claim is a lease, not a status.** One conditional UPDATE increments
`attempt` and pushes `nextAttemptAt` forward; only the winner posts. Unlike
`broadcast_deliveries`, a tick that dies mid-POST leaves a row that becomes due
again rather than one stranded — at-least-once is already the contract here and
consumers are told to dedupe on `webhook-id`, so a silently lost event is the
worse failure. Retries run 1m, 5m, 30m, 2h, 12h, then stop; twenty consecutive
failures disable the endpoint and email the seller.

**Seven events, each with a real emit point**, because a catalogue longer than
its emit points is a checkbox a seller ticks and then waits on for ever. The
card rail's `order.created` fires from the Connect webhook alongside
`order.paid`, not at checkout — a third of Stripe sessions are abandoned and
swept, and emitting there would fire every seller's Zap for orders that never
existed. Manual rails emit at checkout, where the order *is* the commitment.

**The API and the webhooks describe objects identically.** `lib/api/resources.ts`
owns the shapes and both surfaces use it, so a consumer that receives
`order.paid` and then fetches the order sees the same field names — one field
map works against both. Amounts carry `cents`, a currency-correct decimal
`amount` and the code, because the single most common integration bug is
someone mapping the integer and emailing a customer "you paid 4999".

**`POST /contacts` cannot grant marketing consent, by design.** It is the same
invariant `addClient` states: consent is a thing a person gave, and a field in
a request body is a claim that they did. `sendOptIn: true` is the supported
route, and it reuses the public double opt-in flow unchanged, so consent is
written when *they* click.

**The MCP endpoint is dual-era.** Revision `2026-07-28` removed sessions, the
GET stream and the `initialize` handshake, which is what makes a stateless
serverless endpoint correct rather than a compromise — but a great many
shipping clients still open with `initialize`, so both are served on one URL
and dispatch to the same tools. A read-only key never sees the write tools at
all: a model that cannot see a tool does not promise the user something it then
cannot do.

*Not built:* `lead.created` (spec 07 has not landed), a Zapier app listing,
OAuth for the MCP endpoint (a static bearer key is what it takes), and
`contact.created` on the order and CSV-import paths — a buyer arrives inside
`order.created` with their `clientId`, and an import would fire thousands of
events for one click.

New route: `/docs/api`, public and unauthenticated, because somebody deciding
whether Sailo fits their stack has to read it before they have an account.

### The Easytools parity release (30–43)

Scoped 2026-08-19 against 36 screenshots of the Easytools creator panel and
their `llms-full.txt` (10,448 lines). Every claim was verified in source;
see `GAP-2026-08-easytools.md` for the tables and the refusals, and
`RELEASE-PLAN-2026-08.md` for sequencing and the verification gate.

**Wave 0 — unblock.** The chargeback scenario suite has two unresolved imports
and cannot import what it tests; the card-payment webhook path
(`checkout.session.completed` → settlement, invoice numbering, email, release) is
still proven only by unit tests of its pure rules, which `PRODUCTION-PLAN.md` §6
has said for weeks. Both come before spec 30, and the first also gates spec 44.
So do the two decisions: the i18n policy for new admin surfaces (35 locales is
the throttle on this entire release) and which endpoints stop failing open.

**Spec 44 is the one feature in wave 0**, and the only item in this release whose
cost compounds daily. Five kinds of chargeback evidence are never captured, and
evidence not captured cannot be printed later — the argument `ce3.ts` already
makes about `orders.buyerIp`. Every week it waits is a week of orders that can
never be defended.

| Wave | Order | Spec | Effort | Notes |
|---|---|---|---|---|
| 0 | 19 | `44-dispute-evidence-capture.md` | M | **Ships first, alone.** Statement descriptor (0 files today), policy snapshots, per-order message log, delivery confirmation, durable sign-in events. Retroactive — nothing here can be backfilled |
| 1 | 20 | `34-contacts-lists-custom-fields.md` | L | Unifies two half-audiences; supplies 30's `list.joined` trigger; its eight rules are the correctness floor for everything that sends mail |
| 1 | 21 | `30-email-automations.md` | XL | **The headline gap** — "*Not built: flows*" appears three times above. Assembly, not invention: segments, the webhook lease, broadcast sending and `lifecycle`'s three rules already exist. Must not touch `lifecycle/steps.ts` |
| 2 | 22 | `32-checkout-recovery.md` | L | Sessions + status machine + one T+3h mail + randomised discount. Their 10% commission, phone consultants and cross-seller buyer network are refused |
| 2 | 23 | `08-order-bumps.md` | M | Written, unbuilt. **36 supersedes its `products.bumpProductId`** with an `offers` table; keep its `viaBump` attribution |
| 2 | 24 | `36-cross-sells-and-thank-you.md` | L | Post-payment, not in-checkout (their Baymard reasoning, adopted). Flat list; `parent_id` exists and is always null in v1 |
| 2 | 25 | `43-pricing-models.md` | M | PWYW, donation-as-preset, sell windows, manual-rail trials. One migration, no sixth product kind |
| 2 | 25b | `45-order-evidence-pack.md` | L | One PDF per order, rendered on demand from 44's snapshot. **Seven of nine `EVIDENCE_FILE_FIELDS` are things Sailo already holds and currently asks the seller to upload** |
| 2 | 25c | `46-platform-subscription-disputes.md` | M | A seller charging back their Sailo subscription is currently never contested — the schema calls the remedy "a plan downgrade rather than evidence about a parcel". We lose the sub plus a $15 fee and add an uncontested loss to the platform account's own rate |
| 3 | 26 | `07-lead-capture.md` | M | Already written and still wanted; 30 uses it as a trigger source |
| 3 | 27 | `33-waitlists.md` | M | Ships the notification their own docs admit they do not send |
| 3 | 28 | `35-testimonials-wall-of-love.md` | M | A wall of love is **not** `reviews` — shop-scoped, unrated, embeddable. The iframe is the risky part |
| 3 | 29 | `41-seller-legal-pages.md` | S | What finally makes `requireTerms` usable. English-only document, translated chrome |
| 3 | 29b | `47-migrate-from-other-tools.md` | L | Stripe, **Shopify**, **Etsy**, Gumroad, Lemon Squeezy, Paddle → the existing validated CSV row shape. One write path, seven readers. Etsy is a listings-CSV upload, not OAuth. Imports no orders (the invoice sequence) and no marketing consent |
| 2b | 25d | `48-digital-product-depth.md` | L | **`digital_access_details` is one shared column — every buyer of a licence key gets the same string.** Code pools claimed with `FOR UPDATE SKIP LOCKED`, a Lemon-Squeezy-shaped licence API, files per variant, file versions |
| 2b | 25e | `49-membership-depth.md` | L | Fixed term + access-after (a payment plan without an instalments engine), cancellation policy, pause/freeze, seats with per-seat passes, dunning, plan switching |
| 2b | 25f | `50-event-product-depth.md` | L | Ticket tiers with two-level capacity, sessions/recurring, transfer, per-attendee details, `.ics`, venue + event timezone, refund policy. `tickets.tier` finally gets written |
| 2b | 25g | `51-service-and-physical-depth.md` | L | Staff resources (the exclusion constraint moves to (staff, range)), classes, buyer reschedule, intake forms, booking reminders, low-stock alerts, weight bands, multi-shipment |
| 4 | 33b | `52-buyer-data-requests.md` | M | Subject access, erasure, portability. Verification before assembly; suppressions never erased; the invoice sequence unbroken |
| 4 | 30 | `37-seller-team-roles.md` | M | `staff_members` is *Sailo's* roster, not a seller's. `requireShop()` gains a required permission argument — audit every call site and write the count down |
| 4 | 31 | `38-tax-jurisdictions-thresholds.md` | L | Registrations, threshold monitoring, country control, a filable report. We do **not** become a tax provider |
| — | — | ~~`39-custom-domain.md`~~ | — | **Refused 2026-08-19 — do not build.** A shop's address is `sailo.store/<handle>` and always will be. Moved to `deferred/`; the argument is `GAP-2026-08-easytools.md` §4.11 |
| 4 | 33 | `42-analytics-expansion.md` | M | Three pixels, four tiles, scoped share links, a closed link vocabulary with no `?price=` |
| 5 | 34 | `31-integration-scenarios.md` | L | Shares 30's runner. Generic actions; the app-directory refusal stands |
| 5 | 35 | `40-gated-content-collections.md` | L | Supersedes `deferred/18-ecourse.md`, narrowly. Writes **no new access predicate** |

Waves 2–5 are fully parallel: nothing in them blocks anything else in them.
Wave 1 is sequential and 34 comes first.

**The refusals matter as much as the list.** Not building, with the argument in
`GAP-2026-08-easytools.md` §4: the Easypage website builder (the storefront *is*
the page — `15-landing-pages.md` stays deferred), the cross-seller buyer
identity network and 1-click that depends on it (it would put one seller's
buyers in another's checkout, and Sailo is not merchant of record), Easybilling
as a staffed tax service, per-seller sending domains and DKIM, named branding
themes, three-level cross-sell funnels, payment plans and installments, a
logged-in buyer portal, an OAuth app directory, Google-review import, and all
six add-ons their own `llms.txt` marks **Legacy** (Easycookie, EasyFAQ,
Easyoffer, Easytimer, Easycoffee, Easyticker).

## Deferred (`deferred/` — not work)

| Spec | Why it's parked |
|---|---|
| `15-landing-pages.md` | Not Sailo's product direction — the storefront *is* the page. **Re-examined 2026-08-19 against Easytools' Sites tab and still deferred** (`GAP-2026-08-easytools.md` §4.1); the two pieces worth having — an FAQ block and an About block — land in spec 41 |
| `21-media-embeds.md` | Written for a link/URL product kind Sailo does not have, and existed to feed 15 |
| `18-ecourse.md` | **Superseded 2026-08-19 by `40-gated-content-collections.md`**, which is the narrow shape: ordered, gated, resumable files reusing the download gate and `membershipAccess`. Not a video player — that stays out |
| `19-community.md` | Covered better by 06: memberships can gate a Discord/WhatsApp invite |
| `24-paypal-rail.md` | A second payment platform; Stripe + manual rails cover buyers |
| `25-autodm.md` | Blocked on Meta app review — a human/business task, not agent work |
| `26-education-hub.md` | We have education (blog programme, onboarding); no in-admin hub needed |
| `39-custom-domain.md` | **Refused, not parked.** The owner: *"we will never add it, it will always be sailo.store/store-name."* A build was started on 2026-08-19 and backed out the same day — see `GAP-2026-08-easytools.md` §4.11, and `drizzle/0038_custom_domains.sql` for why that number is spent |

Verified ahead of Easytools on 2026-08-19 (do not "fix" downwards): physical
goods with variants and stock, the booking engine, manual/chat payment rails,
member door passes, partner payouts, 35-language admin *and* storefront, the HQ
back-office and risk desk, Standard Webhooks + REST v1 + MCP + `/docs/api`, the
**chargeback pipeline** (dispute scope, inquiry-vs-chargeback, the real deducted
cost, early fraud warnings, the 4.5 MB evidence budget enforced from the set, and
a full Visa Compelling Evidence 3.0 implementation — Easytools has no equivalent
and specs 44–46 extend it rather than replacing anything), and email broadcasts (19-rule dynamic segments, RFC 8058 one-click unsubscribe,
bounce/complaint suppression, per-shop and platform quotas).

Already at parity (do not build): CSV export, coupons, storefront theming,
35-language admin+storefront, powered-by removal (`removeBadge`), automatic
payouts via Stripe Connect (12 only *surfaces* them), product affiliates,
invoices, reviews, tax, physical goods, manual rails, booking engine.
