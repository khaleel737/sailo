# Release plan — Easytools parity to production

Companion to `GAP-2026-08-easytools.md`, which holds the analysis and the
refusals. This holds the order, the gates and the things that will go wrong.
Written 2026-08-19.

Read `README.md`'s ten rules first. They are not preamble — rule 1 (a schema
change is not shipped until its migration has run against production) and rule 4
(stage explicit paths; concurrent agents work in this tree) are the two that have
already cost this repo an outage and someone else's commit.

---

## Wave 0 — Unblock and prove. Nothing here is a feature.

Everything after this wave is more trustworthy for having done it. One item
(§0.4, evidence capture) does add tables, and it is here rather than later for a
reason no other spec can claim: it is retroactive, and the cost of waiting
compounds every day.

### 0.1 The disputes suite cannot import what it tests — fix first

```bash
DATABASE_URL=postgres://k:k@localhost/k npx knip --no-progress
```

```
Unresolved imports (2)
  @/lib/hq/disputes   apps/web/e2e/scenarios/dispute-files.scenario.ts:140:9
  @/lib/hq/disputes   apps/web/e2e/scenarios/disputes.scenario.ts:108:3
```

HQ moved to `apps/hq` and these two did not follow. They are the **chargeback**
scenarios — `disputes.scenario.ts` is the largest scenario file in the tree at
1,583 lines. A money-path suite that cannot resolve its import is a suite that is
not testing what its name says.

Point them at `@sailo/commerce/disputes` or whatever the moved surface is now,
run the scenario suite, and **read the count** — if the number of passing
scenarios does not go up, the import was fixed and the tests are still skipped.

**This gates §0.4.** Specs 44, 45 and 46 all change dispute code, and the
pipeline they change is the most intricate in the repo — `scope`, inquiry vs
chargeback, out-of-order webhooks, the 4.5 MB evidence budget, CE3.0. Do not
touch it while its suite is dark.

### 0.2 The card-payment webhook has no integration test — the largest real gap

`PRODUCTION-PLAN.md` §6 has said this since the scenario stack landed:

> Card orders need Stripe test mode and a forwarded webhook, so the whole
> `checkout.session.completed` path — settlement, invoice numbering, the
> confirmation email, download release — is still exercised only by unit tests
> of its pure rules.

Nothing in the fourteen specs touches this and everything in them makes it worse:
spec 36 charges a saved card, spec 32 resumes a checkout, spec 43 introduces a
buyer-chosen amount. All three land on the settlement path.

The database has existed since `e2e/scenarios/up.sh`. The recipe is in the
README:

```bash
./e2e/scenarios/up.sh
npx dotenv -e .env.local.test -- npx next dev -p 3100
stripe listen --forward-to         http://localhost:3100/api/stripe/webhook \
              --forward-connect-to http://localhost:3100/api/stripe/connect/webhook
stripe trigger checkout.session.completed
```

Prove, in order: settlement writes the payment; the invoice number is the next
one in the sequence and is never reused; the confirmation email is queued once;
`downloadReleasedAt` is set; a replayed event with the same id changes nothing;
an event for another account's object is refused by
`packages/payments/src/stripe/ownership.ts`.

**Do this before spec 30.** It is the assertion every later wave leans on.

### 0.3 Clear knip's remainder so the next run is signal

3 unused files (`apps/hq/e2e/scenarios/purge.ts`,
`apps/hq/test-stubs/server-only.ts`,
`packages/email/src/testing/server-only-stub.ts`), 1 unused dependency
(`@sailo/notifications` in `apps/hq/package.json`), 2 unused exports in
`apps/hq/src/lib/platform/disputes.ts` (`getShopDisputes`, `getDisputeOrders`),
2 unused types (`AffiliateRow`, `EscalationLevel`).

Check each before deleting: a `server-only` stub is often load-bearing for a test
runner and knip cannot see that. If one is, add it to `knip.json` with the reason,
which is more useful than deleting it and finding out.

### 0.4 Spec 44 — dispute evidence capture. The only feature in wave 0.

`44-dispute-evidence-capture.md`. Five things a chargeback is answered with that
Sailo does not record: the statement descriptor the buyer saw
(`statement_descriptor` → **0 files**, and `unrecognized` is *"usually a
statement-descriptor problem"* per `docs/chargebacks.md`), the policy text they
agreed to (`termsAcceptedAt` records *when*, never *what*), every message sent to
them, whether it arrived (`ORDER_STATUSES` stops at `shipped`), and a sign-in
history that outlives a better-auth session.

It is here, ahead of the engine and everything else, for the reason `ce3.ts`
already gives about `orders.buyerIp`:

> *"It is retroactive in the worst way. The two prior transactions must
> *already* carry the data points, so a platform that starts capturing IP
> addresses today cannot use CE3.0 for another four months."*

Every week this waits is a week of orders that can never be defended. It is M
effort, has no dependencies, and needs 0.1 done first because it changes dispute
code the broken suite covers. Nothing else in the plan compounds like this.

Specs 45 (the evidence pack PDF) and 46 (platform subscription disputes) depend
on it and wait for wave 2.

### 0.5 Decision A — the i18n policy. **Answered: option 3.**

35 admin locales × ~950 lines. The fourteen specs add roughly 9 admin sections
and ~400 strings; at full parity that is ~14,000 lines of translation and it will
dominate the calendar. Three options and a recommendation are in
`GAP-2026-08-easytools.md` §6.

**Answered 2026-08-19: machine-translate on merge, with a reviewed glossary that
is never machine-touched** — the recommendation, for the reason the gap analysis
gives: a 35-language admin is the differentiator against Easytools, who ship two,
and going faster by dropping to English gives up the advantage rather than
deferring it.

Built, and it changed what we know about the debt:

| | |
|---|---|
| `npm run check:i18n` | `scripts/i18n/check.mts`. Reports per surface and per locale; exits non-zero only on a **storefront** hole, which is a compile error anyway |
| `npm run i18n:fill` | `scripts/i18n/fill.mts`. Fills gaps from `en.ts`; needs `ANTHROPIC_API_KEY` |
| the pure half | `packages/i18n/src/tooling/` — gap diffing, the glossary, the splicer, the placeholder guard. No dependencies, because `@sailo/i18n` is imported by apps/api and by the mobile app |

**What the first run found.** The storefront is *complete* in all 34 locales —
that is the compile-error constraint working. The admin is **14,212 strings
short** before this release adds anything: every locale is missing ~418 of 1,230,
so roughly a third of the admin already falls back to English at runtime. The
release's ~400 new strings are a 3% increase on a debt that was already there.

Three things the pipeline will not do, each because the alternative is worse than
the gap it leaves:

- **It never writes a protected money section.** `glossary.ts` lists them —
  checkout, cart, rails, invoice, billing, membership, download on the
  storefront; billing, payments, payouts, coupons, orders and their status
  vocabularies in the admin. 2,006 of the missing strings are in these and wait
  for a human. A wrong label on a marketing heading is embarrassing; a wrong one
  on a refund is a claim about somebody's money that they act on.
- **It never overwrites an existing translation**, machine-written or not, so a
  human correction survives the next run.
- **It refuses a string whose `{placeholders}` changed.** A renamed placeholder
  typechecks, splices, renders, and shows a customer the literal text
  `{count}` — invisible to every test and to any reviewer of a language they do
  not read.

The section names are checked against the real `en.ts` at load, so renaming a
money section fails the tool rather than silently unprotecting it.

### 0.6 Decision B — which endpoints fail closed. **Answered.**

`PRODUCTION-PLAN.md` §3 has carried one open item for two weeks: when Redis is
cold every ceiling in the app vanishes, deliberately, and now audibly. It was
left as a product call.

Three of the new specs make it more expensive: spec 32's session-create is a
**public write** on every checkout view, spec 30's send path spends quota, and
spec 37's invite endpoint is an account oracle if unthrottled. Decide
per-endpoint, not globally, and write the decision beside each `rateLimit` call.

**Answered 2026-08-19: three categories fail closed, everything else stays
open.** `rateLimit` takes `{ onOutage: "closed" }`; the default is unchanged, so
every call site that says nothing behaves as it always did.

| Category | Why |
|---|---|
| **Public writes** — newsletter and shop signup, reviews, affiliate applications | Unauthenticated, create rows, and most of them send mail. An hour without a ceiling is an hour of unbounded rows from anybody |
| **Spends money or a shared quota** — broadcast test sends, `/forget-password`, `/send-verification-email`, the HQ magic link | The Resend allowance also carries buyers' receipts, so an open failure here takes down transactional mail as collateral |
| **Existence oracles and secret guessing** — the coupon budget, `/reset-password`, `/sign-up/email`, REST API-key auth, portal tokens, door passes, download and invoice tokens | The ceiling *is* the cost of guessing. Failing open turns a cache outage into an unmetered offline attack conducted online |

**Deliberately left open, recorded beside each call:**

- **`createOrderIntent`.** This is the checkout. Closing it stops every shop on
  the platform taking an order; ten a minute per address is a runaway-client
  guard, not a boundary, and the real boundaries on that path — stock claims,
  coupon budgets, ownership checks — are all in Postgres.
- **`/sign-in/email`.** Closing it locks every seller out of their own shop, and
  better-auth answers a failed sign-in identically whether or not the account
  exists, so there is no oracle to close.
- **2FA verify.** It has a database-backed lockout underneath (ten failures,
  fifteen minutes) that does not depend on Redis — the compensating control the
  others lack.
- **The per-order seller notification.** It spends quota, but 1:1 with orders:
  it cannot run away without a separate bug, and closing it silences every
  seller's order alerts during an outage.

`RateVerdict` gained a `reason` — `under` | `over` | `outage` | `unconfigured`.
That distinction is load-bearing, not cosmetic: a fail-closed refusal is **not**
an answer about the request, and a surface that renders it as one is lying. The
coupon path is the worked example — a spent budget answers `not_found`, which
correctly says nothing about whether the code exists, while an outage answers a
new `COUPON_MESSAGES.unavailable` ("we couldn't check that code just now"),
because telling a buyer holding a real code that it is invalid is exactly what
rule 5 forbids.

`unconfigured` is the fourth value and the reason local development and the
scenario suite still work: an unset `REDIS_URL` is a deployment with no ceilings,
not a ceiling that broke, and nothing fails closed against a limiter that was
never installed.

---

## Wave 1 — The engine

Sequential. 34 before 30, because 30's `list.joined` trigger needs the list.

| # | Spec | Why it is first |
|---|---|---|
| 1 | **34** — contacts, lists, custom fields, unsubscribes | Unifies two half-audiences; supplies 30's trigger; its eight rules are the correctness floor for everything that sends mail |
| 2 | **30** — email automations | The headline gap. `README.md` says "*Not built: flows*" three times |

After wave 1 the plan **parallelises**. Nothing in waves 2–5 blocks anything else
in waves 2–5, which is deliberate: this tree is worked by concurrent agents and a
serial plan wastes them.

### The one thing that must not happen in wave 1

Spec 30 must not touch `packages/marketing/src/lifecycle/steps.ts`, and the HQ
Journeys screen must keep reading it. The argument is in
`GAP-2026-08-easytools.md` §3.2 and in the header comment of
`apps/hq/src/app/(panel)/marketing/journeys/page.tsx`. A pull request that
migrates the twelve rungs into `automations` should be refused.

---

## Wave 2 — Revenue. Fully parallel.

| Spec | Note |
|---|---|
| **32** — checkout recovery | Highest revenue per line in the list. Take the mechanism, refuse the commission and the shared buyer network |
| **08** — order bumps | Written and unbuilt since the last gap analysis. **Read 36 first**: it supersedes 08's `products.bumpProductId` with an `offers` table and keeps its `viaBump` attribution |
| **36** — cross-sells, upsell tiles, thank-you page | Post-payment, flat, `parent_id` present and always null |
| **43** — PWYW, donation preset, sell windows, manual trials | One migration. The only place in the checkout where a price comes from the request — clamp at both sinks |
| **45** — order evidence pack (PDF) | Turns seven of nine `needs_seller` evidence slots into `held`. Renders on demand from 44's immutable snapshot — do **not** store a PDF per order |
| **46** — platform subscription disputes | Sailo stops losing its own chargebacks uncontested. Includes the rule that matters most: when the seller is right, refund rather than contest |

**45 and 46 share a risk of their own:** both render documents and submit them
to a card network in somebody else's name. The rule in both specs is the same and
it is absolute — never state a fact Sailo does not hold. A pack claiming
"delivered" because a seller ticked a box, or printing today's refund policy
against a sale from March, is a false claim to a bank made on the seller's
behalf. Every line carries its provenance and its date.

**Shared risk across the first four:** all four touch pricing. `resolveLines`,
`previewOrder` and `createOrderIntent` are the three sinks, and
`PRODUCTION-PLAN.md`'s recurring shape is *"guard applied at one sink not its
twin"*. Whoever lands second re-runs the first one's scenarios, not just their own.

---

## Wave 2b — Product depth. Fully parallel, one migration each.

The four product kinds, each missing what a seller hits in month one. Sequenced
after wave 2 because three of them touch pricing or claims that wave 2 also
touches, and before wave 3 because a seller cannot be reached about a product
they could not configure.

| Spec | The riskiest line in it |
|---|---|
| **48** — digital depth | The code claim. `FOR UPDATE SKIP LOCKED`, claimed at release not checkout, never returned to the pool on refund |
| **49** — membership depth | `membershipAccess` gains **one** branch and no more. Its single-implementation property is why grace, the members list, the download gate, the door pass and cancellation all work without a second copy |
| **50** — event depth | Two-level capacity (tier × product, session × product), narrower first, one transaction |
| **51** — service & physical depth | **The exclusion constraint moves from (shop, range) to (staff, range).** That is the guarantee Sailo never double-books. Change it, then run the concurrency scenarios *first* and read the count |

All four follow the `0034_product_kinds.sql` discipline: every column nullable or
defaulted so an existing catalogue reads and sells identically the moment it lands.

## Wave 3 — Reach. Fully parallel. Each is a trigger source for wave 1.

| Spec | Note |
|---|---|
| **07** — lead capture | Already written. `README.md` calls it "Next up"; the consent column it waited for exists |
| **33** — waitlists | Needs 43's sell window for the "not released" case. Ships the notification Easytools admits they do not |
| **35** — testimonials / wall of love | The embed is the risky part: its own CSP, `frame-ancestors *`, and a cross-origin iframe E2E |
| **41** — seller legal pages | Small, and it is what makes `requireTerms` usable. English-only document, translated chrome |
| **52** — buyer data requests | Statutory 30-day clock. Verification before assembly, always; the suppression list is never erased |
| **47** — migrate from other tools | Stripe, CSV and **Etsy** ungated; Shopify and Etsy are the migrants our competitors cannot serve. Etsy is CSV-only on purpose — no OAuth, no token at rest. Imports **no** orders and **no** consent |

---

## Wave 4 — Business. Fully parallel.

| Spec | Note |
|---|---|
| **37** — team members and roles | Riskiest change in the whole plan: `requireShop()` gains a required permission argument and every call site is audited. Count them and write the number down, as `PRODUCTION-PLAN.md` did for 32 actions and 20 HQ queries |
| **38** — tax jurisdictions, thresholds, country control, report | Sum stored minor units; never re-derive tax from a rate |
| ~~**39** — custom domain~~ | **Refused 2026-08-19 — do not build.** A shop's address is `sailo.store/<handle>` and always will be. `GAP-2026-08-easytools.md` §4.11 |
| **42** — analytics expansion | Sequenced after 30/32/07 so no tile ships always-zero |

---

## Wave 5 — Content. Largest, least urgent, most likely to be reshaped.

| Spec | Note |
|---|---|
| **31** — integration scenarios | Shares 30's runner. Actions are generic; the app-directory refusal stands |
| **40** — gated content collections | Supersedes `deferred/18-ecourse.md`. Writes **no new access predicate** — if one appears in the diff it is wrong |

---

## The verification gate, per spec, not per wave

From `README.md` rule 2, in this order, and the exit code is the answer:

```bash
nvm use 22.22.1                                   # node 20.10 breaks vitest at startup
npx tsc --noEmit
npx vitest run                                    # concurrency 1 if turbo: parallel fails a random package on .vite-temp
./e2e/scenarios/up.sh && npx vitest run --config vitest.scenarios.mts
npm run build                                     # read $?, not the output
npx oxlint
DATABASE_URL=postgres://k:k@localhost/k npx knip
npm run check:i18n
```

Plus, per spec, the two that a green suite does not cover:

- **Render it and read the visible text.** Every RSC payload embeds the error
  boundary's copy, so grepping a page for "something went wrong" matches the
  healthy ones. `curl | grep` is not a health check.
- **Verify in a browser.** Typecheck misses `use server` export rules, swallowed
  queries answering 200, and DOM bugs. Seed a session and run it — and use
  `.env.local.test`, never `.env.local`, which is production.

Money-path specs (32, 36, 43, 38, and 07's zero-value path) need **scenario**
coverage, not unit coverage. That is where four defects were found last time by
writing them.

---

## Migration numbering, with several agents in the tree

The last applied migration is `0034_product_kinds.sql`. Ten of the fourteen specs
add one, and two agents both writing `0035_` is a merge conflict in the one place
a merge conflict is expensive.

Rule for this release: **claim the number in a one-line commit to
`apps/web/drizzle/` before writing the SQL**, and apply to production before
pushing code (rule 1). If two agents collide, the later one renumbers — the
migration that has already run against production wins, always.

---

## What "production ready" means at the end of this

The feature list is not the finish line. These are:

1. `npx tsc --noEmit` → 0, `npx oxlint` → 0 errors, `knip` → clean, build exit 0.
2. The scenario suite covers the **card** path end to end through a forwarded
   webhook — settlement, invoice numbering, email, release, replay, ownership.
3. Every public route carries a ceiling, and Decision B is recorded beside each
   one that fails open.
4. Every seller-facing write names a permission (spec 37) and every HQ write
   names a `StaffCapability` — the hole that shipped once.
5. `npm run check:i18n` is green under whichever policy Decision A picked, and
   the debt, if any, is listed rather than silent.
6. Every new public write (session create, waitlist join, testimonial submit,
   progress write, share view) has been probed for being an existence oracle,
   and answers the same sentence whatever it found.
7. Every seller-supplied URL — avatar, video, embed, webhook, iCal, domain —
   goes through the SSRF guard **at the write**, with the `lookup` hook rather
   than resolve-then-fetch. Six writes had to be fixed once; this release adds
   at least four more.
8. No feature in this release presents itself as tax or legal advice.
8b. Every line in a generated evidence document names where it came from and when
   it was recorded, and no document asserts a fact the database does not hold. A
   dispute pack is a statement to a card network; an overstated one loses the
   case and damages the seller who submitted it.
9. The refusals in `GAP-2026-08-easytools.md` §4 are still refused. Scope creep
   into a page builder, a buyer network, a tax service or per-seller sending
   domains is the failure mode this plan is written against.

---

## If the calendar has to be cut

Cut from the back. Waves 0 and 1 are not optional — wave 0 because the chargeback
suite is broken and the card path is unproven, wave 1 because it is the gap this
whole exercise identified.

If only one wave after that can ship, ship **wave 2**: recovery, bumps,
cross-sells and PWYW are the four that pay for the rest, and every one of them is
independent of every other thing in this document.
