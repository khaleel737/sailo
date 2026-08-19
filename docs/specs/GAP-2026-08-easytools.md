# Easytools parity — the gap analysis, and what we are *not* building

Written 2026-08-19 against 36 screenshots of the Easytools creator panel
(`cart.easy.tools`, captured 08:56–09:06 on 2026-08-19) and against their own
technical documentation: `https://www.easy.tools/llms-full.txt`, 10,448 lines,
551 KB, every feature described to the field level. That file is the primary
source here, not the marketing site — it names tables, statuses, triggers,
webhook payloads and commission terms, which is what a scope needs.

Every "Sailo has / lacks" claim below was verified in this tree on the day it
was written, with the command beside it. Re-measure before planning: more than
one agent works here and the numbers move.

---

## 0. The summary, before the tables

Sailo is **not behind Easytools on commerce**. It is ahead on several things
they do not have at all (physical goods with variants and stock, a real
booking engine, manual/chat payment rails, member door passes, 35-language
storefront *and* admin, an HQ back-office with a risk desk). It is behind on
exactly one axis, and that axis is the whole reason this document exists:

> **Easytools automates the seller's marketing. Sailo automates Sailo's.**

Sailo has a twelve-rung behaviour-triggered email ladder — anchored on real
timestamps, re-checked at send time, every rung expiring — and it mails
*sellers about Sailo*. A seller cannot build one of those for their own
buyers. `docs/specs/README.md` says so three separate times, in the notes for
spec 14: **"*Not built:* flows."**

So the headline gap is not a missing page. It is a missing *engine*, and Sailo
already owns every part of it:

| The engine needs | Sailo already has it, here |
|---|---|
| A trigger vocabulary | `packages/marketing/src/broadcasts/segments.ts` — 19 rule types |
| Trigger → SQL | `broadcasts/segment-sql.ts` — correlated EXISTS over the consent floor |
| Anchors, re-check at send, expiry | `packages/marketing/src/lifecycle/steps.ts` |
| A durable step queue with retries | `packages/workflows/src/webhooks/{claim,attempt,policy}.ts` — the lease |
| Send + suppression + quota | `broadcasts/{send,quota,reputation}.ts`, `email_suppressions` |
| A per-recipient delivery ledger | `broadcast_deliveries` |
| An event surface to trigger from | `webhook_endpoints` + 7 emit points |

Building automations is therefore **assembly, not invention**. That is the
single most leveraged item in this plan and it is sequenced first.

The second-order finding is less comfortable: **the throttle on every feature
below is not engineering, it is translation.** 35 admin locales × ~950 lines
each. See §6.

---

## 1. What was measured

```bash
find . -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' | grep -v node_modules | wc -l   # 218 files
grep -rhoE '\b(it|test)\(' --include='*.test.ts' --include='*.test.tsx' --include='*.scenario.ts' . | wc -l   # 3008
DATABASE_URL=postgres://k:k@localhost/k npx knip --no-progress   # see §7
ls packages/i18n/src/admin/ | grep -v index | wc -l              # 35
ls packages/i18n/src/dictionaries/ | grep -v index | wc -l       # 35
perl -0777 -ne 'while(/pgTable\(\s*"([a-z_]+)"/gs){print "$1\n"}' packages/db/src/schema/*.ts | sort -u | wc -l   # 56 tables
find apps/web/drizzle -name '00*.sql' | sort | tail -1           # 0034_product_kinds.sql
```

Code volume, for sizing: `apps/web` 95.7k lines, `apps/hq` 27.2k,
`apps/mobile` 17.4k, `apps/docs` 4.1k, `apps/api` 2.3k;
`packages/i18n` **60.0k**, `commerce` 18.2k, `core` 14.0k,
`design-system` 12.5k, `api` 8.9k, `marketing` 8.6k, `payments` 5.3k,
`db` 5.3k, `workflows` 4.4k.

Product kinds today (`packages/core/src/catalog/variants.ts`):
`physical | digital | service | event | membership`. Five. Not `lead`, not
`donation`.

---

## 2. Their surface, ours, and the verdict

Verdicts are one of five, and they mean exactly this:

- **Parity** — do not build. Ours does the job; sometimes better.
- **Parity+** — ours is ahead. Named so nobody "fixes" it downwards.
- **Partial** — the spine exists, a named piece is missing. Cheap.
- **Build** — genuinely absent and wanted. Has a spec below.
- **Refuse** — absent, and we are choosing to stay absent. Argument given.

### 2.1 Store

| Easytools | Sailo today | Verdict | Spec |
|---|---|---|---|
| **Products** — 12 templates (digital download, ebook, SaaS, course, membership, webinar, live event, service, freebie, audio, donation, physical) | 5 kinds; digital splits file/link/code; variants, stock, `sku`, `maxPerOrder`, booking, tickets, memberships | **Partial** — no freebie/lead, no donation, no pay-what-you-want, no payment plans | 07, **43** |
| **Orders** | `admin/orders`, server-side filters, CSV | Parity | — |
| **Customers** | `admin/clients` + tags (GIN), manual add, CSV import | Parity | — |
| **Discounts** | `admin/coupons`, per-shop + global, min spend, use caps, guess ceiling | Parity | — |
| **Affiliates** | `admin/affiliates` + `partners`, payouts, program settings, public signup | **Parity+** — they have no payout ledger | — |
| **Waitlists** | nothing. `waitlist` matches 0 files | **Build** | **33** |
| **Automations** (Scenarios / Executions / Apps) | signed webhooks (Standard Webhooks), REST v1, MCP; no scenario builder, no app directory | **Build (reshaped)** | **31** |
| **Reports** (Transactions / Reports) | `admin/payments`, invoices, fee lines | **Partial** — no tax report | **38** |
| **Recovery** (Checkout sessions / Recovery settings / Surveys) | a 24h abandoned-order sweep; no session row, no recovery mail, no surveys | **Build** | **32** |
| **Analytics** | dashboard, product performance, outbound clicks, plan-clamped ranges, daily rollup | **Partial** — fewer tiles, no share link | **42** |
| Settings → **My store** | `admin/settings` — identity, invoice identity, legal links, deletion | Parity | — |
| Settings → **Branding** (named themes) | `accentColor`, `theme`, `layout` on `shops` | **Refuse** (§4.5) | — |
| Settings → **Payments** | Stripe Connect + manual/chat rails, adaptive presentment, payout visibility | **Parity+** — they are Stripe-only | — |
| Settings → **Invoicing & taxes** | `taxMode` manual\|stripe, inclusive/exclusive, tax on delivery, invoice sequence, VAT id | **Partial** — no jurisdictions, thresholds, country control, tax report | **38** |
| Settings → **Analytics** (pixels) | GTM, Meta, TikTok — validated ids, consent-gated, scoped CSP | **Partial** — no Google Ads, LinkedIn, Pinterest | **42** |
| Settings → **Custom domain** | nothing, and nothing planned | **Refused** — §4.11 | ~~39~~ |
| Settings → **API & Webhooks** | both, plus MCP, plus `/docs/api`, plus connect-time SSRF guard on a `lookup` hook | **Parity+** | — |
| Settings → **Notifications** | `notificationPrefs`, `notificationEmail`, once-per-order across rails | Parity | — |
| **Team** (Members + Roles, default role) | `staff_members` is **Sailo's own** staff, not a seller's. One user per shop | **Build** | **37** |

### 2.2 Sites

| Easytools | Sailo today | Verdict | Spec |
|---|---|---|---|
| **Websites** / Easypage — AI landing-page builder, sections, timers, contact forms, custom domain | nothing; `15-landing-pages.md` already in `deferred/` | **Refuse** (§4.1) | — |
| **Creator page** — storefront of products/links/media | `[handle]` — categories, filters, search (trigram, 64ms→0.5ms), reviews, cart | **Parity+** | — |
| **Legal pages** / Easylegal — generates T&C, privacy, about, footer | platform legal is written; a seller gets `termsUrl` + `requireTerms` | **Build (S)** | **41** |

### 2.3 Campaigns

| Easytools | Sailo today | Verdict | Spec |
|---|---|---|---|
| **Email** campaigns | `broadcasts` — 19-rule dynamic segments, coupon + product cards + button resolved at send, scheduling, RFC 8058 one-click unsubscribe, bounce/complaint suppression from a signature-verified webhook, per-shop and platform quotas, Gmail-safe inline-styled markdown | **Parity+** | — |
| **Automations** — trigger → send / timer / branch / audience-filter, run metrics | **nothing.** README says "*Not built:* flows" ×3 | **Build — first** | **30** |
| **Audience** — contacts, filter groups | `clients` + `newsletter_subscribers` + segments, but two half-audiences and no unified screen | **Partial** | **34** |
| **Lists** | tags on `clients` come close; no list object, no double opt-in per list | **Build (S)** | **34** |
| **Unsubscribed** | `email_suppressions` + `marketing_opt_outs` — correct model, no screen | **Partial** (screen only) | **34** |
| Settings → **Senders and domains** | all mail leaves `sailo.store` from 5 verified addresses | **Refuse for v1** (§4.4) | — |
| Settings → **Custom fields** | nothing on contacts; nothing on checkout | **Build (S)** | **34** |
| Settings → **API keys** | built | Parity | — |

### 2.4 Testimonials, Courses

| Easytools | Sailo today | Verdict | Spec |
|---|---|---|---|
| **Testimonials** / Easylove — "wall of love", collect by link, import Google reviews, embed, show in checkout | `reviews`: per-**product**, 1–5 stars, `isApproved`, shown on the product page | **Build** — different object (§3.5) | **35** |
| **Courses** / Easyplayer — player, files, layout, login wall, student data | digital files + download tokens + membership access decided at download time + member passes; `18-ecourse.md` in `deferred/` | **Build lite** — re-opened (§3.6) | **40** |

### 2.5 Checkout mechanics (their deepest area)

| Easytools | Sailo today | Verdict | Spec |
|---|---|---|---|
| **Order bumps** — in-cart, 3 display types, custom price, crossed-out original | nothing; spec exists, unbuilt | **Build** | **08** |
| **Cross-sells / down-sells** — post-purchase, drag-and-drop funnel, 3 levels deep, instant charge on saved card | nothing | **Build v1, flat** (§4.6) | **36** |
| **Upsells** — two variants on one tile, toggle | variant options exist; no linked-variant tile | **Partial → fold into 36** | 36 |
| **Custom form fields** — 8 types, per-checkout and per-variant | nothing | **Build (S)** | **34** |
| **Limited quantities** | `trackInventory`, `stockQuantity`, `maxPerOrder`, conditional-UPDATE claim | **Parity+** | — |
| **Time-limited offers** | nothing (events have `eventStartsAt`; no sell-window) | **Partial** | **43** |
| **Crossed prices** | `compareAtCents` | Parity | — |
| **Free trials** | `trialDays` — Stripe rail only, and the form says so | **Partial** | **43** |
| **Pay what you want** | nothing | **Build** | **43** |
| **Payment plans / installments** | nothing | **Refuse** (§4.7) | — |
| **Lead magnets / zero-price links** | nothing | **Build** | **07** |
| **Prefilled checkout links, promo-code links, variant links, QR codes** | order QR + door passes exist; no link-parameter vocabulary | **Partial (S)** | **42** |
| **Thank-you page config, transactional email customisation** | fixed copy, 35 locales | **Partial** | **36** |
| **Customer portal** | signed one-shot token pages (`/u`, `/s`, `/n`), Stripe billing portal for members | **Refuse** (§4.8) | — |
| **1-click purchase off a cross-seller network** | nothing | **Refuse — hard** (§4.2) | — |

### 2.6 Chargebacks and evidence — not a parity item, and the most expensive gap in the plan

Easytools barely addresses this: their docs cover refunds, subscription statuses
and "handling past due transactions", and their chargeback answer is Easybilling
— *their staff* handling billing support on a $0.50/transaction service. There is
nothing here to reach parity with.

Sailo's dispute pipeline is meanwhile the most sophisticated thing in the repo,
and it was missed in the first pass of this analysis. Verified in source:
`disputes` with `scope`, `feeCents`, `deductedCents`, `networkReasonCode`,
`dueBy`, `evidenceSnapshot`, `completenessBp`, `enhancedEligibility`, `ce3Status`;
`early_fraud_warnings`; `download_events` as Stripe's `access_activity_log`;
`dispute_evidence_files` enforcing the 4.5 MB combined network cap from the *set*;
seven pure modules under `packages/core/src/disputes/` including a full **Visa
Compelling Evidence 3.0** implementation; and `docs/chargebacks.md`, verified
against the live API in test mode on 2026-08-17.

Three real gaps remain, and they are worth more per line than anything in §3:

| Gap | Verified | Spec |
|---|---|---|
| **Nothing generates a document.** All nine `EVIDENCE_FILE_FIELDS` resolve `needs_seller` every time, with a `FILE_ASKS` string telling the seller to upload a receipt, their refund policy, their messages. **Seven of the nine are things Sailo already holds and could print.** A seller an hour from a deadline is being asked to hand-assemble documents out of our own database | `assemble.ts`, `FILE_ASKS` | **45** |
| **Five kinds of evidence are never captured.** `statement_descriptor` → **0 files** (and `unrecognized` is *"usually a statement-descriptor problem"* per our own doc). `termsVersion`/`termsSnapshot` → **0 files**, so `termsAcceptedAt` records *when* but never *what*. No per-order communications log, though Sailo sends most of the mail. No `delivered_at` — `ORDER_STATUSES` has `shipped` and our own doc says *"a tracking number showing 'in transit' is not delivery"*. And `session` rows expire, so a 120-day-old subscription dispute has no sign-in history left | grep, `order-status.ts`, `auth.ts` | **44** |
| **Platform disputes are never contested.** The schema says the remedy for a seller charging back their Sailo subscription is *"a plan downgrade rather than evidence about a parcel"* — and `assembleEvidence` has no platform branch at all. So we lose the subscription **plus a $15 fee**, submit nothing, and add an uncontested loss to the platform Stripe account's own rate | `disputes.ts`, `assemble.ts` | **46** |

**Spec 44 is the most time-sensitive item in this entire document**, and the
reason is already written down in `ce3.ts` about a different column: *"It is
retroactive in the worst way… a platform that starts capturing IP addresses
today cannot use CE3.0 for another four months."* The same is true of a policy
snapshot, a communications log and a delivery confirmation. Every week 44 waits
is a week of orders that can never be defended, and it is only M effort with no
dependencies. It goes in wave 0.

### 2.7 Beyond parity — gaps neither platform's nav shows

Swept 2026-08-19 across the whole tree, not against Easytools. Verified, not
assumed — the regexes and their hit counts are in the session log.

| Gap | Verified | Verdict |
|---|---|---|
| **No migration path from any named platform** | `importFromStripe` → 0 files. CSV import exists for products, clients, tickets | **Build — 47.** Shopify and **Etsy** are the migrants Sailo can serve and its competitors cannot — and Sailo's own metadata markets it as an "Etsy alternative" in two files |
| Gift cards / store credit | 0 files | **Defer.** A stored-value liability with its own accounting and fraud surface |
| Product bundles / kits | 0 files (`productBundle`, `bundleItems`) | **Defer** — spec 36's `offers` table covers most of the intent |
| Pre-orders / backorders | 0 files | **Defer** — spec 33's waitlist is the honest version |
| Returns / RMA flow | 0 files | **Defer.** Refunds exist; a returns *workflow* is its own release |
| Order editing after placement | 0 files | **Refuse.** An editable paid order breaks the invoice sequence and the dispute snapshot |
| Tips / gratuity at checkout | 0 files (`tipCents`) | **Fold into 43** — pay-what-you-want with a zero floor is the same mechanism |
| Subscription **pause**, fixed term, seats, dunning, switching | 0 files / named "not built" | **Build — 49.** Reversed: these are what a member asks for in month one |
| Digital **per-buyer codes / licence keys** | `digital_access_details` is one shared column — every buyer gets the same string | **Build — 48.** The most concrete product defect found in this whole exercise |
| Event **tiers, sessions, transfer, .ics, venue timezone** | 3 event columns total; `tickets.tier` exists and nothing writes it | **Build — 50** |
| Service **staff/resources, classes, reschedule, intake** | one shop-wide calendar; `booking_claims` excludes on (shop, range) | **Build — 51** |
| Low-stock alerts | 0 files | **Build — 51.** One claimed query on the existing notification prefs |
| Subscription pause / freeze | 0 files — already named "not built" in the memberships notes | **Defer**, as recorded |
| Plan switching, proration, seats | already named "not built" in the memberships notes | **Defer**, as recorded |
| SMS / WhatsApp broadcast | 0 files (`twilio`) | **The strategic one.** Sailo is WhatsApp-first for *ordering* and email-only for *marketing*. See below |
| Buyer referral / loyalty / points | 0 files | **Defer.** Creator referral exists (spec 13); buyer-side is a different product |
| A/B testing | 0 files | **Defer.** Spec 42's share links and 32's randomised discount cover the near-term need |
| Customer LTV / cohorts | only `cohort` inside dispute stats | **Fold into 42** — `clients` plus orders already hold it |
| Accounting export (Xero, QuickBooks) | 0 files | **Defer** — spec 38's tax report and the CSV export are the filable artefacts |
| Buyer GDPR data-request flow | 0 files | **Build — 52.** Seller deletion is built (spec 03); a *buyer's* request is not, and it is the only item in the plan with a statutory clock |
| UTM capture and campaign attribution | **exists** — `visits.utmSource/Medium/Campaign`, parsed in `analytics/traffic.ts`, grouped in `breakdowns.ts` | Parity |
| Structured data / JSON-LD | **exists** on storefront and product pages | Parity |
| Push notifications | **exists** — `push_tokens`, `@sailo/notifications/push`, an API router | Parity+ |

**The WhatsApp asymmetry, and the decision taken on it.** Sailo's premise is
that ordering happens on WhatsApp — that is what makes it work in every country
without Stripe onboarding. Every marketing feature in this plan sends *email*.
`twilio` / `whatsappBroadcast` match 0 files.

**Decided 2026-08-19 by the owner: not building it.** Recorded here so nobody
re-opens it as an oversight. The cost is not the engine — it is WhatsApp Business
API access, per-template Meta pre-approval, a 24-hour customer-service window,
per-message pricing and app review: the same wall that put
`deferred/25-autodm.md` in `deferred/`. Spec 30's `send` step is **email-only**,
with no channel abstraction built speculatively.

---

## 3. What we are building, and why

Fourteen specs. Numbering continues the existing sequence; `07` and `08` were
already written and unbuilt, and are pulled into this release.

| # | Spec | Effort | Why now |
|---|---|---|---|
| **30** | Email automations (flows) | **XL** | The headline gap. Assembly of parts we own. Everything else in Campaigns is downstream of it. |
| 31 | Integration scenarios | L | Turns the webhook we shipped into something a non-developer can use. |
| 32 | Checkout recovery + sessions | L | The highest-revenue feature per line of code in the whole list. |
| 33 | Waitlists | M | Cheap, and it is the only honest answer to a sold-out or unreleased product. |
| 34 | Contacts, lists, custom fields | L | Unifies two half-audiences; 30 needs list membership as a trigger. |
| 35 | Testimonials — wall of love | M | Reviews are per-product; social proof is per-shop. Different object. |
| 36 | Cross-sells, upsell tiles, thank-you page | L | Post-purchase, not in-checkout. Baymard reasoning in §4.6. |
| 37 | Seller team members and roles | M | Blocks every seller with an assistant. Nothing about it exists. |
| 38 | Tax jurisdictions, thresholds, country control, tax report | L | The compliance half we can honestly own without becoming merchant of record. |
| ~~39~~ | ~~Custom domain~~ | — | **Refused 2026-08-19.** Read as table stakes here; the owner's answer is that a shop's address is `sailo.store/<handle>` and always will be. §4.11 |
| 40 | Gated content collections ("courses lite") | L | Re-opens `18-ecourse.md` with a narrower shape. §3.6. |
| 41 | Seller legal page generator | S | `requireTerms` already exists and has nothing to point at. |
| 42 | Analytics expansion + share + link vocabulary | M | Three pixels, one report tile short, no shareable stat. |
| 43 | Pricing models: PWYW, donation, sell windows, manual trials | M | Four small holes in one table, one migration. |
| **07** | Lead capture (already written) | M | `30` wants "signed up to a lead magnet" as a trigger. |
| **44** | Dispute evidence capture | **M** | **Ships first, alone.** Retroactive: evidence not captured cannot be printed later. §2.6 |
| **45** | Order evidence pack (PDF) | L | Turns seven of nine `needs_seller` file slots into `held`, without asking the seller for anything |
| **46** | Platform subscription disputes | M | Sailo defends its own revenue. Currently loses every one uncontested |
| **47** | Migrate from other tools | L | Stripe, **Shopify**, **Etsy**, Gumroad, Lemon Squeezy, Paddle. The reason people do not switch — and `layout.tsx` already ships "Etsy alternative" as a keyword. §2.7 |
| **48** | Digital depth — code pools, licence keys, files per variant, versions | L | `digital_access_details` hands every buyer one shared string. A defect, not a gap |
| **49** | Membership depth — fixed term, policy, pause, seats, dunning, switching | L | Billing-complete, product-incomplete |
| **50** | Event depth — tiers, sessions, transfer, .ics, venue, policy | L | Best ticketing engine in the category, three configuration columns |
| **51** | Service & physical depth — staff, classes, reschedule, intake, shipments, low stock | L | One calendar per shop is what stops Sailo serving anyone with staff |
| **52** | Buyer data requests | M | The only item in the plan with a statutory clock |
| **08** | Order bumps (already written) | M | Written, unbuilt, and independent of everything. |

### 3.1 Why automations are one engine with two front doors

Easytools ships two automation products: **Store → Automations** (scenarios:
purchase → call an app) and **Campaigns → Automations** (flows: trigger →
email/timer/branch/filter). They look unrelated in the nav and are the same
machine underneath: an event, a stored graph, a per-subject cursor, a durable
step runner, a run log.

Build one runner (`packages/workflows/src/automations/`), two step catalogues,
two screens. Building two runners means two retry policies, two idempotency
stories and two ways to lose a step — and the retry lease in
`webhooks/claim.ts` is already the hard part, solved and tested.

### 3.2 The rule-engine objection, answered

`apps/hq/src/app/(panel)/marketing/journeys/page.tsx` argues, at length and
correctly, *against* a database rule engine:

> "The ladder is code — anchors, predicates and expiries in
> `@sailo/marketing/lifecycle` — because every one of those is a decision that
> should be reviewed in a pull request rather than typed into a form at speed.
> A rule engine here would move twelve reviewed decisions into a database where
> nobody can see them change."

That is right for **Sailo's mail to sellers** and does not transfer to
**a seller's mail to buyers**, for one reason: a seller cannot open a pull
request. Twelve decisions we make on behalf of a fleet belong in code and in
review. A hundred thousand decisions sellers make about their own buyers
cannot be, and refusing them a form does not keep the decisions reviewed — it
keeps them unmade.

**So both stay.** Spec 30 does not touch `lifecycle/steps.ts`, the HQ Journeys
screen keeps reading it, and the platform ladder is never expressed as a row.
Any spec that proposes migrating the twelve rungs into the new engine is
wrong and should be refused.

### 3.3 Recovery: take the mechanism, refuse the business

Easytools' Checkout Recovery is **a staffed service on a 10% commission**.
Read their own words: consultants phone the buyer, they run remarketing
campaigns "at our expense", and — the part that decides this for us — "our
customers have their data … remembered in the system. This means that we also
have data of people from our entire network in your cart."

Sailo cannot do that and must not want to. We are not merchant of record; the
seller is. There is no cross-seller buyer network, and building one would put
one seller's buyer list inside another seller's checkout.

What we take is the machinery, which is excellent and unencumbered:

- a `checkout_sessions` row per checkout view, with their status machine —
  `opened → error → recovering → recovered | finalized`, plus `help_requested`;
- one recovery email at T+3h with a signed resume link;
- an optional, **randomised** one-time discount — their reasoning is sound and
  worth quoting in the spec: award it every time and buyers learn to abandon
  on purpose;
- effectiveness reporting: recovered funds, actions, rate.

No commission, no phone calls, no shared buyer data. That is a better product
and a shorter spec.

### 3.4 Waitlists, and the thing they admit

Their docs say plainly: *"We won't send any automatic notifications to your
waitlist on your behalf."* A waitlist that cannot mail the list is a CSV with
extra steps.

Sailo should ship the notification, because after spec 30 it is a trigger and
two rows — `waitlist.signup` as an automation trigger, and "back in stock" as
an event the sweep already knows how to detect (`stockQuantity` crossing zero
upward, `trackInventory` on). This is where owning the engine first pays.

### 3.5 Testimonials are not reviews

`reviews` is `(shopId, productId, authorName, rating 1..5, body, isApproved)`.
It answers "what do buyers think of *this product*", renders on the product
page, and is correct as it stands.

A wall of love answers "should I trust *this seller*". It is shop-scoped, has
no rating, accepts video and an avatar, is collected by sending a link to a
past buyer, and is embedded on a checkout or a third-party site. Same-shaped
table, different object, different surface. Building it as a `productId`-null
review would put an un-rated, un-approved, embeddable object into the query
that renders product pages — and that query is cached under `shopTag`. Keep
them apart.

### 3.6 Courses: re-opening `18-ecourse.md`, narrower

`deferred/18-ecourse.md` was parked as "not Sailo's product direction now".
The screenshots put Courses in the primary nav, and the deferral is worth
revisiting — but **not** by building Easyplayer. A video player with layouts,
styling and DRM is a separate business.

What Sailo is one step away from is *ordered, gated, resumable content*:

- files already exist (`product_files`, position-ordered);
- delivery is already token-gated (`/download/[token]`);
- **entitlement is already decided at read time, not mint time** — the rule
  `membershipAccess` and the door pass both follow;
- membership already gates it, on card *and* manual rails.

Missing: a lesson grouping, an order, a completion mark, and a page that lists
them. That is spec 40, and it is `collections` + `collection_items` +
`content_progress`. If it lands and sellers ask for streaming, that is when
Easyplayer becomes a question.

---

## 4. What we are *not* building, and the argument

Refusals are the useful half of a scope. Each of these was considered and
declined on the date above; re-open only with the owner's say-so.

### 4.1 Websites / Easypage — stays deferred

`deferred/15-landing-pages.md` refused this with one line that is still true:
**the storefront *is* the page.** Sailo's storefront already has categories,
filters, trigram search, reviews, a cart, 35 locales, theming and an OG image
per product. An AI section builder alongside it is a second content system
with its own editor, its own preview, its own publish state and its own SEO
surface, competing with the one we already ship.

The one piece worth stealing is *sections on the storefront* — a hero, an FAQ,
a testimonial strip. Those are 35 and 41, not a page builder.

### 4.2 The Easycart buyer network / 1-click across sellers — refused hard

This is the load-bearing difference between the two products. Easytools pools
buyer identity across every seller on the platform, which is what makes their
1-click purchase, auto-filled invoices and cart recovery work. It also means a
buyer's details reach a seller they never bought from.

Sailo's whole legal shape is the opposite: the seller is merchant of record,
Sailo never touches the money, buyers belong to the seller. Pooling identity
would break that in a way no setting can repair, and would import a GDPR
posture we would then have to defend. **Not a roadmap item. A boundary.**

### 4.3 Easybilling as a service ($0.50/txn tax + invoicing + refunds + support)

Their recommended tax option is a **service**: they calculate, issue, handle
refunds and answer the buyer's billing mail, for $0.50 a transaction. That is
a staffed operation with tax liability attached.

Sailo already offers the two defensible options — a flat declared rate, and
Stripe Tax on the *seller's own* connected account, where the registrations
and the liability sit with the person who owns them. Spec 38 adds the
seller-protective reporting on top. We do not become a tax provider.

### 4.4 Sender domains / per-seller DKIM — not in v1

Attractive, and it is how a seller's campaign stops saying `via sailo.store`.
It is also a deliverability sub-product: domain verification, DKIM/SPF/DMARC
records, per-domain warmup, per-domain reputation, and a support queue for
sellers whose DNS is wrong. Sailo's current model — five verified addresses on
one domain, `marketing@` deliberately separated so a bad campaign cannot land
a password reset in spam — is a *deliberate* reputation design, documented in
the README.

Revisit when a seller's campaign volume makes shared reputation the binding
constraint. Not before spec 30 exists to create that volume.

### 4.5 Named branding themes

`shops` carries `accentColor`, `theme` and `layout`, and the storefront is one
template on purpose ("One template, no checkout to configure"). Multiple named
themes with a theme editor is a design-system product. The accent/theme/layout
triple covers the actual request, which is "look like me".

### 4.6 Cross-sell funnels three levels deep

Their nested drag-and-drop funnel is genuinely clever and the reasoning for
*post*-purchase placement is worth adopting verbatim — they cite Baymard:
66% of shoppers made to pass a cross-sell before paying reported extreme
frustration. So Sailo's cross-sell goes **after** payment, like theirs.

The nesting does not come. Three-level parent/child down-sell trees need a
funnel editor, a traversal engine and a "which offer did they see" ledger, to
serve the small number of sellers running a real funnel. Spec 36 ships a flat
ordered list of post-purchase offers. If nesting is asked for, the parent
column is one migration away — design the table for it, do not build the
editor.

### 4.7 Payment plans and installments

Their own docs describe this as a subscription with a fixed term, and note it
is *not* Klarna-style. Sailo has fixed-term subscriptions in reach
(`billingInterval` + `billingIntervalCount`) but the money path is the risk:
partial delivery against partial payment, what a failed third instalment does
to access already granted, and refunds across instalments. That is a money-path
release of its own, not a corner of this one.

### 4.8 A logged-in buyer portal

Sailo deliberately has no buyer accounts. Delivery, invoices and subscription
management all reach the buyer through a signed, single-purpose token — and
members get Stripe's own billing portal, so a Sailo button can never claim
"cancelled" while the card keeps being charged. Adding buyer accounts adds an
auth surface, a password-reset flow and a support queue, to replace links that
already work. Refused.

### 4.9 Custom CSS and custom `<head>` code on the checkout

`customCss` and `customHead` match **0 files**, and they stay at zero. Easytools
offers both (§`styling-with-custom-css`, §`custom-code-in-head-section`).

Sailo's stated product is "One template, no checkout to configure." Seller CSS on
a checkout is a permanent conversion-support surface — every broken layout on
every browser becomes a Sailo ticket about a rule a seller wrote. Seller
`<head>` code is worse: it voids spec 09's scoped CSP, which exists because an
unvalidated third-party script tag on a payment page is the highest-value
injection point in the product.

What the underlying request actually is — "make it look like me" — is served by
`accentColor`, `theme`, `layout`, a logo, and spec 41's storefront blocks.

### 4.11 Custom domains — refused, 2026-08-19

**A shop's address is `sailo.store/<handle>`, and it always will be.** The
owner's decision, in their own words: *"Remove custom domains, we will never
add it, it will always be sailo.store/store-name."*

This one is worth stating loudly because it does not read like a refusal from
the outside. It sits in `README.md`'s own "Not built yet", it is table stakes
on every competitor's pricing page, and `39-custom-domain.md` is a complete,
buildable spec — so it is exactly the item a future agent picks up believing
it was simply never got to. It was got to. A build was started on 2026-08-19
and backed out the same day at the owner's instruction.

The spec's own "Details" section says what it costs, and the cost is the
argument: **cookie scope, fixed-origin checks and a per-domain CSP**. A session
cookie issued on a hostname a third party controls is an auth surface handed to
that third party; every fixed-origin comparison in the app assumes one origin;
and the serving host becomes a variable in the security headers of every
response. That is infrastructure, not a feature, and it is bought against
*"one template, no checkout to configure, live in about three minutes"*.

**Nothing about it is to be built** — no `shop_domains` table, no hostname
column on `shops`, no host-based routing in `proxy.ts`, no per-domain
canonical, sitemap or CSP, no DNS verification, no platform domains API. The
spec is in `deferred/` with this decision on its front page.
`drizzle/0038_custom_domains.sql` is a tombstone: the number was claimed for
the build that was backed out, and it cannot be reused without leaving a gap in
a sequence whose order is the only record of what was applied where.

### 4.10 Also refused, briefly

- **App directory / named OAuth connectors.** Already refused twice in this
  tree, for the same reason both times: each logo is an OAuth client, a refresh
  token at rest and a support surface, forever. Spec 31 connects by API key
  and generic HTTP, which reaches Zapier, Make, n8n and everything behind them.
- **Deferred payments / "simulate installments".** See 4.7.
- **Importing Google reviews.** Needs a Places API key per seller and carries
  Google's attribution terms. Manual import lands in 35; the API does not.
- **Easytools' legacy add-ons** — Easycookie, EasyFAQ, Easyoffer, Easytimer,
  Easycoffee, Easyticker. Their own `llms.txt` marks all six **Legacy**. We
  are not going to build what they are retiring. FAQ sections land inside 41;
  cookie consent already exists (`cookieConsent`, 2 files).

---

## 5. The two decisions that are not mine

**Decision A — the i18n policy for new admin surfaces.** See §6. It moves the
total effort of this plan by roughly 2.5×. It is the first thing to answer,
because every spec below is estimated twice until it is.

**Decision B — do rate limits still fail open?** `PRODUCTION-PLAN.md` §3 has
carried exactly one open item for two weeks: when Redis is cold, every ceiling
in the app vanishes, deliberately and now audibly. That was left as a product
call and it is still open. Spec 32 (recovery links) and spec 30 (automation
sends) both add endpoints where failing open is more expensive than it was.
Pick per-endpoint, not globally.

---

## 6. The constraint that sets every estimate

```bash
ls packages/i18n/src/admin/ | grep -v index | wc -l   # 35
wc -l packages/i18n/src/admin/en.ts                   # 1920
```

**35 admin locales and 35 storefront dictionaries, 60,000 lines in total —
`packages/i18n` is the largest package in the monorepo, larger than
`commerce` and `core` put together.** `en.ts` is the typed source and missing
keys are compile errors, which is the right design and also means *a new admin
screen cannot ship until it has been translated 35 times.*

The fourteen specs below add, at a rough count, **9 new admin sections and
around 400 new strings**. At full parity that is 14,000 lines of translation
and it will dominate the calendar — the code is the smaller half of this plan.

Three ways out, and this is Decision A:

1. **Full parity, as today.** Honest, consistent, and roughly 2.5× the
   engineering time. Rules 3 in `README.md` stays as written.
2. **English-first with runtime fallback for new surfaces only.** `en.ts` gains
   the keys; the other 34 fall back until translated; a `check:i18n` report
   lists the debt instead of failing the build. Ships features at engineering
   speed and admits a mixed-language admin for a while.
3. **Machine-translate on merge, human-review the money words.** A script fills
   34 locales from `en.ts` on the way in; a small reviewed glossary (price,
   tax, refund, subscription, cancel) is never machine-touched. Keeps parity,
   costs a pipeline, and risks a bad string in a place where a bad string is
   expensive.

**Recommendation: 3, with 2 as the fallback for anything shipping before the
pipeline exists.** The reason to prefer 3 over 1 is that 35-language admin is
a real differentiator against Easytools, who ship two — throwing it away to go
faster gives up the advantage; automating it keeps both.

---

## 7. What "production ready" is missing that is *not* a feature

Measured today, not estimated. This is the part of "get this app production
ready" that the fourteen specs do not touch.

**knip is clean, and the two real findings are:**

```
Unresolved imports (2)
  @/lib/hq/disputes   apps/web/e2e/scenarios/dispute-files.scenario.ts:140:9
  @/lib/hq/disputes   apps/web/e2e/scenarios/disputes.scenario.ts:108:3
```

Two scenario files import a path that does not resolve — HQ moved to its own
app and these did not follow. They are in the **disputes** suite, which is the
largest scenario file in the tree (1,583 lines) and covers chargebacks. Fix
before anything else in this document: a money-path suite that cannot import
what it tests is a suite that is not testing it.

This matters more than it did before §2.6 was written. Specs 44, 45 and 46 all
change dispute code, and the suite that covers the existing pipeline — the most
intricate code in the repo — is not currently running against it.

Also: 3 unused files (`apps/hq/e2e/scenarios/purge.ts`,
`apps/hq/test-stubs/server-only.ts`,
`packages/email/src/testing/server-only-stub.ts`), 1 unused dependency
(`@sailo/notifications` in `apps/hq`), 2 unused exports in
`apps/hq/src/lib/platform/disputes.ts` (`getShopDisputes`,
`getDisputeOrders`), 2 unused types. Small, and worth clearing so the next
knip run is signal.

**The uncovered path named in `PRODUCTION-PLAN.md` §6 is still uncovered.**
Card orders need Stripe test mode plus a forwarded webhook, so
`checkout.session.completed` — settlement, invoice numbering, the confirmation
email, download release — is proven only by unit tests of its pure rules. The
database to do it against has existed since `e2e/scenarios/up.sh` landed. This
is the single largest correctness gap in the repo and it is not on the feature
list. **Put it before spec 30.**

**On "redundant code and bloatedness":** measured, the code is not
redundant — knip finds 3 unused files and 2 unused exports across 250k lines,
which is unusually clean. What is heavy is real:

- `packages/i18n` at 60k lines (§6) — the actual bloat, and it is load-bearing;
- 3,008 test blocks across 218 files — heavy, and the scenario suites are the
  reason four money defects were found by writing them. Not a cut candidate;
- five scenario files over 700 lines and `apps/hq/(panel)/orders/[id]/page.tsx`
  at 1,303 lines — split candidates, in `PRODUCTION-PLAN.md` §4's method:
  extract one seam, run `tsc`, read what it says;
- two seed scripts at 1,313 and 1,168 lines, plus `scripts/social/*` at 1,528
  — dev-only, ship nothing, leave alone.

The honest conclusion is that this repo's problem is not bloat. It is that
**the seller-facing automation surface is missing and the card-payment webhook
has no integration test** — one feature gap and one test gap, both nameable,
both in this plan.

---

## 8. Order of work

Ordering rule: *unblock, then prove, then build the engine, then the screens
that need it.* Full sequencing, dependencies and release gates are in
`RELEASE-PLAN-2026-08.md`.

| Wave | Items | Why here |
|---|---|---|
| **0 — Unblock** | disputes-suite imports; knip's five leftovers; the card-order webhook scenario; **44** (evidence capture); Decision A; Decision B | Everything but 44 makes the rest trustworthy; 44 is here because it is retroactive and compounds daily |
| **1 — Engine** | **30** (flows), **34** (contacts/lists/custom fields) | 34 supplies 30's list trigger; 30 unlocks 32, 33, 35, 40 |
| **2 — Revenue** | **32** (recovery), **08** (bumps), **36** (cross-sell), **43** (pricing models), **45** (evidence pack), **46** (platform disputes) | Highest revenue per line; all independent of each other. 45 and 46 defend revenue already earned |
| **2b — Product depth** | **48** (digital), **49** (membership), **50** (events), **51** (service & physical) | What a seller hits in month one of selling each kind. Independent of each other; each is one kind's own migration |
| **3 — Reach** | **07** (lead capture), **33** (waitlists), **35** (wall of love), **41** (legal pages) | Each is a trigger source for wave 1's engine |
| **4 — Business** | **37** (team/roles), **38** (tax/thresholds), **42** (analytics), **47** (importer), **52** (buyer data requests) | What a seller needs to grow past themselves, plus the two obligations. 39 was here and is refused — §4.11 |
| **5 — Content** | **31** (scenarios), **40** (gated collections) | Largest, least urgent, most likely to be reshaped by what waves 1–4 teach |

Nothing in waves 2–5 blocks anything else in waves 2–5. That is deliberate:
after wave 1 the plan becomes parallelisable across agents, which is how this
tree is actually worked.
