# Feature Specs — the build list

One file per feature, written to be handed to an agent cold. Each spec says
what the feature is, the exact tables and files involved, the edge cases
that will otherwise be missed, the tests that prove it, and a "done when".
Every "Sailo has / lacks" claim was verified in source during the
2026-08-10 gap analysis, not assumed.

**Everything in this folder is wanted.** Specs we decided not to pursue live
in `deferred/` and are not work — do not pick them up without the owner
saying so.

## Rules for every agent, before any spec

1. **A schema change is not shipped until its migration has run against
   production.** Hand-write `drizzle/NNNN_<name>.sql`, apply to prod first,
   then push code. Green build/tests/types prove nothing about the database.
2. **Verification gate before every commit:** `npx tsc --noEmit` →
   `npx vitest run` → scenario suite (`./scripts/scenarios/up.sh` then
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
| 7 | `06-recurring-memberships.md` | XL | Not built — largest remaining feature |
| 8 | `08-order-bumps.md` | M | Not built |

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
| 18 | `14-email-broadcasts.md` | L | **Built**, minus flows and scheduling |
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
| 19 | `16-outbound-webhooks.md` | M | Zapier substrate; SSRF rules inside |

## Deferred (`deferred/` — not work)

| Spec | Why it's parked |
|---|---|
| `15-landing-pages.md` | Not Sailo's product direction — the storefront *is* the page |
| `21-media-embeds.md` | Written for a link/URL product kind Sailo does not have, and existed to feed 15 |
| `18-ecourse.md` | Not needed — not Sailo's product direction now |
| `19-community.md` | Covered better by 06: memberships can gate a Discord/WhatsApp invite |
| `24-paypal-rail.md` | A second payment platform; Stripe + manual rails cover buyers |
| `25-autodm.md` | Blocked on Meta app review — a human/business task, not agent work |
| `26-education-hub.md` | We have education (blog programme, onboarding); no in-admin hub needed |

Already at parity (do not build): CSV export, coupons, storefront theming,
35-language admin+storefront, powered-by removal (`removeBadge`), automatic
payouts via Stripe Connect (12 only *surfaces* them), product affiliates,
invoices, reviews, tax, physical goods, manual rails, booking engine.
