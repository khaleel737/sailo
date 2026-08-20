# Sailo — production hardening plan

Rewritten 2026-08-07 after a security audit and fifteen fixes. Every number was
measured with the command beside it, not estimated. Re-measure before planning:
this repo has more than one agent in it and the numbers move.

---

## 1. Where it stands

```bash
# Since the monorepo cutover (2026-08-12) these run from the repo root…
pnpm typecheck --concurrency=1; echo $?                # 0
pnpm test --concurrency=1                              # all workspaces green
pnpm lint                                              # 0 errors
pnpm build > /dev/null 2>&1; echo $?                   # 0
DATABASE_URL=postgres://k:k@localhost/k npx knip       # 0 unused files, 0 unused exports
# …and these from apps/web (the numbers below date from the flat layout):
npx vitest run --config vitest.scenarios.mts           # scenarios, against a real database
npx playwright test e2e/
E2E_BASE_URL=https://sailo.store npx playwright test e2e/security.spec.ts e2e/checkout.spec.ts
```

| | Start of the day | Now |
|---|---|---|
| Unit tests | 909 | **1206** |
| Tests against a real database | **0** | **48** |
| Type errors | 0 | 0 |
| Lint errors | 13 | 0 |
| Unused exports (knip) | 27 | **0** |
| Unlisted dependencies | 3 | **0** |
| Security findings open | — | **6, all ranked in §3** |
| Files over 300 lines (real code) | 20 | 13, four of them prose or layout |

**The number that matters most is the second row.** Until today no test in this
repo had ever placed an order, because the only database the app could reach
was production's. `e2e/scenarios/up.sh` now gives it one it may dirty, and
writing those 48 scenarios found four defects that reading had not: a
check-then-act in `upsertClient` that ended a buyer's checkout on an error page
for double-clicking, the concurrent double-booking, and two of my own fixtures
being wrong about the product rather than the other way round.

## 2. What the audit found, and what was done

Fifteen defects, each verified by reading the code path end to end before acting.
Ranked by what they cost.

**Closed — money or data**

1. **Every admin form round-tripped prices through a flat `/100`.** The parser,
   the formatter and the Stripe handoff had learned about minor units; the
   render-back-into-a-form path had not. A JPY seller pressing Save without
   typing anything turned ¥1,000 into ¥10; a KWD seller turned 12.500 into
   125.000 and charged ten times. Export→import did it to a whole catalogue.
   Fourteen call sites. `centsToAmount` is the missing inverse; the test is the
   round trip.
2. **SSRF via product images and shop avatars.** `lib/og.tsx` fetched any URL it
   was handed, from two public unauthenticated routes, with `cache: "no-store"`.
   Nothing validated `avatarUrl`, `logoUrl` or the image columns. Closed at the
   fetch *and* the four writes, against the allowlist `next.config.ts` and the
   CSP already enforce. `redirect: "manual"` so the host check cannot be
   bypassed by a `Location`.
3. **Staff account pre-hijack.** Sign up as the roster address with your own
   password; better-auth mails the real inbox a genuine-looking confirmation;
   one click sets `emailVerified` without disturbing the credential — the
   library calls `revokeUnprovenAccountAccess` on the magic-link path and not on
   this one. `requireStaff` was then satisfied. Password auth is now refused on
   both sign-up and sign-in for rostered addresses.
4. **Refunds raced.** Two $50 refunds on a $100 order in the same second both
   passed `checkRefund`, both moved money, and the second write recorded the
   same $50 as the first. The amount is claimed in SQL before Stripe is called
   and released if Stripe refuses.
5. **`isStoredFileUrl` trusted every Vercel Blob store on the internet.** Now
   pinned to the store id in `BLOB_READ_WRITE_TOKEN`, falling back to the host
   check when the token is absent.

**Closed — availability, privacy, correctness**

6. `rollup` and `sitemap` cron routes were fully public when `CRON_SECRET` was
   unset — three copies of one guard, two of them wrong. One copy now, fails
   closed, constant-time.
7. `applyAsAffiliate` replied "your code is X" to an unauthenticated caller and
   had no rate limit. Constant response now, throttled, plan-gated.
8. `setLocale` purged the whole prerendered tree from a client-callable action —
   and was doing no work, because pages that read the cookie were never in the
   prerender.
9. Better-auth's rate limiting was memory-backed, so per-instance and effectively
   absent. Now on Redis via `consume`, the atomic path.
10. A draft product's `opengraph-image` rendered its title, price and photo
    publicly; the page one level up calls `notFound()`.
11. Seven live routes were claimable as shop handles. The test now reads
    `src/app` off disk — which is how `/refunds` was found after six had been
    added by hand.
12. A misconfigured service (booking on, no duration) skipped slot re-derivation
    entirely and accepted any time within a year.
13. One basket could book the same slot twice — `busyFor` reads committed
    orders, and no line being priced is one yet.
14. A refused legacy file burned a download allowance per attempt.
15. The buyer's email was never checked for being an address, so receipts and
    download links failed silently.

**Verified and found clean** — the checkout's server-side re-pricing, webhook
signature verification and account scoping, `requireShop`/`requireStaff` on all
32 actions and all 20 `/hq` queries, download token entropy and claiming, CSV
formula injection, blob upload keys, replica routing, and `"use cache"` keying.

**Verified as not exploitable:** the `x-forwarded-for` spoofing concern. Probed
against production by bursting a rate-limited endpoint with a rotating header —
the 429s still arrive, so Vercel overwrites the header and every rate-limit key
in the app is trustworthy.

---

## 3. Still open, ranked

One left, and it is a product decision rather than an engineering one.

| # | Where | What | Why not yet |
|---|---|---|---|
| 1 | every `rateLimit` call | **All limits fail open** when Redis is cold. | Deliberate, and no longer silent: the transition logs once each way, so "every ceiling in the app just vanished" is a line in the log rather than an absence of throttling that looks like not being attacked. What is left is a product decision — whether some endpoint should fail *closed* instead — and that is yours, not mine. |

### Closed since

**Calendar squatting.** The sweep matched `card` only, so a bank-transfer or
COD booking held its slot until the seller cancelled it by hand, and a shop's
week could be made unbookable by anyone willing to book and not pay.

The reason manual orders were left alone is sound for stock and wrong for a
calendar: units are fungible and a seller can see the count is off, while a
held hour silently stops being bookable. So the sweep now also reclaims
bookings that are unpaid, still `new`, on a non-card rail, and older than
`BOOKING_HOLD_HOURS` (72h — longer than the slowest bank transfer clears).

`new` is what makes that safe without a seller-facing setting. A booking
deliberately stays `new` through payment because checkout promises the buyer
the shop will confirm the time, so an order still sitting at `new` is one
nobody has answered — and a seller who *has* answered moved it to `confirmed`,
which removes it from the sweep permanently. That covers the case this would
otherwise get wrong, a service paid on the day and booked weeks out, using the
same click the buyer was already told to expect. Paid bookings are never
touched. Four scenarios in `checkout.scenario.ts` pin all of it, including that
this did not become an expiry on unpaid manual orders generally.

**Both enumeration oracles.** A coupon guess now costs against its own ceiling
(10 per 5 minutes, separate from the 120/min quote limit) because a working
discount code is a bearer token. `checkHandle` is capped at 120/min — framed as
bounding cost rather than hiding disclosure, since handle existence is already
public from the storefront.

**`?q=` now has a trigram index** (`drizzle/0005`), and getting it used took
more than adding one. Two GIN indexes, one per column, need a `BitmapOr`, and
measured against 40k products the planner costed that *above* a sequential scan
and refused it — Neon runs the default `random_page_cost = 4`, which is
pessimistic for its storage. Rather than retune the planner database-wide,
which changes every query in the app, the index covers `title || ' ' ||
coalesce(description, '')` as one expression, so the search is a single
condition the planner picks unprompted: **64ms → 0.5ms** on a selective term.

That leaves the query and the migration coupled by an expression that must
parse identically in both places, and drift is silent — the results stay
correct and only the plan degrades. `search.scenario.ts` asserts on the
`EXPLAIN` output through the exported expression itself, so a one-character
change fails it; that was verified by making one.

**Every route now carries a ceiling.** The audit's inventory listed four with
a guard and no limit — `/api/upload`, `/api/download/[token]/[fileId]`,
`/api/export/[type]` and `/invoice/[token]/pdf`. All four have one, keyed on
whatever identifies the resource being spent: the shop for an upload or an
export, the token for a download or an invoice, so a buyer on a phone that
changes address mid-transfer does not read as two callers. The cron routes use
a bearer secret, the Stripe routes a signature, and better-auth's endpoints the
Redis limiter in `auth.ts`.

**Closed since this document was rewritten:** three-decimal settlement — the
five currencies quoted to three places and settled to two were charged an
amount their own invoice did not say; the storefront 500 (`?sort=toString`),
concurrent double-booking, the settlement path having no test, the checkout N+1,
unbounded admin reads, `/hq` aggregates on the primary, three caches that had
silently stopped working, two caches that lied about plan changes, and four
missing rate limits.

---

## 4. Phase C — split by responsibility

| File | Was | Now | State |
|---|---|---|---|
| `lib/stripe-webhooks.ts` | 680 | 5 modules, largest 321 | **Done.** Split by the question each part answers; `ownership` is the security seam and has its own file and header. |
| `lib/actions/orders.ts` | 598 | 521 + a 196-line resolver | **Done enough.** `resolveOrderIntent` is the half where failure is free — nothing it does touches a row. What is left is the commit-and-settle path, which is one story. |
| `[handle]/.../checkout-panel.tsx` | 618 | 545 + a 118-line hook | **Partly.** `useCheckoutQuote` owns the server conversation; the form is the next cut, by step. |
| `hq/(panel)/accounts/[id]/page.tsx` | 562 | 562 | Not started — four tables in one page. |
| `lib/email/messages.ts` | 528 | 528 | Not started — split by message. |
| `(marketing)/page.tsx` | 482 | 482 | Not started — sections. |
| `[handle]/.../order-sheet.tsx` | 422 | 422 | Not started. |
| `lib/blog.ts` | 402 | 402 | Reviewed and hardened, never split. |
| `(legal)/terms,privacy,refunds` | 570/560/344 | — | **Leave whole.** Prose is data. |
| `lib/invoice-pdf.ts` | 318 | — | **Leave whole.** Positional layout; each section depends on the `y` the last one left. |
| `src/i18n/**` | — | — | **Leave whole.** Dictionaries are data. |

The method that works, and the reason to keep going: extract one seam, run
`npx tsc --noEmit`, and **read what it says**. Splitting the webhooks turned
three accidentally-private functions into a real boundary. Lifting the
checkout's quote found `couponFor` called twice with nothing making the two
agree. Extracting the resolver found `delivery` being `undefined` rather than
`null` — a distinction that carries meaning — and a payment row's `type` being
asserted as something the database never promised.

## 5. Rules this codebase earned

- **A schema change is not shipped until the migration has run.** Build, tests
  and types are all green without a database; the outage that taught this was
  three columns and a push.
- **`curl | grep` is not a health check.** Every RSC payload embeds the error
  boundary's copy, so grepping any page for "something went wrong" matches the
  healthy ones. Render it and read the visible text.
- **Verify by exit code.** `npm run build` prints "Failed to type check", not
  "Failed to compile".
- **A comment asserting a guarantee is a claim that gets tested.** Three false
  ones were found today: "typing a staff address proves nothing", "every page
  reads the cookie so the whole tree is stale", and a host check that proved the
  host was Vercel's rather than ours.
- **Another agent is in this repo.** Stage explicit paths; `git add -A` once
  committed someone else's source without its dependencies.
- **When a defect is found, grep for the second copy before fixing the first.**
  Nearly every finding above had one.

---

## 6. The e2e gap — mostly closed

34 Playwright tests pass and **none of them places an order**, for the reason
they never could: the dev server runs against `.env.local`, whose
`DATABASE_URL` is the same Neon database production uses.

That is now worked around rather than lived with. `e2e/scenarios/up.sh`
starts a throwaway Postgres behind a local Neon HTTP proxy — the proxy is the
load-bearing part, because the app speaks Neon's HTTP protocol and a plain
container cannot answer it — and `vitest.scenarios.mts` points the app's own
`getDb()` at it with no change to application code:

```bash
./e2e/scenarios/up.sh
npx vitest run --config vitest.scenarios.mts     # 25 scenarios
```

The suite refuses to start if `DATABASE_URL` is not local, so it cannot be
aimed at production by accident.

Twenty-five scenarios cover who may sell, what the order costs, stock, digital
delivery, coupons, cancellation, abandonment and the sweep — including the two
concurrency races (last unit, last coupon use) that a single-threaded test
cannot see. Writing them immediately found a real defect: `upsertClient` was a
check-then-act against two unique indexes, so a double-clicked "Buy now" ended
the buyer's checkout on an error page.

**What is still not covered.** Card orders need Stripe test mode and a
forwarded webhook, so the whole `checkout.session.completed` path — settlement,
invoice numbering, the confirmation email, download release — is still
exercised only by unit tests of its pure rules. That is the next thing worth
building, and it is now a much smaller step: the database is already there.

---

## 7. 2026-08-20 — the monorepo cleanup pass

Twenty-seven commits from five parallel audits (duplication, test redundancy,
post-cutover bugs, database/load, hygiene), every finding re-verified by
reading the code before acting. Measured at the end of the pass:

```bash
pnpm turbo test typecheck lint --concurrency=1 --force   # 89/89 tasks green
                                                         # 4,314 vitest + 188 jest tests
DATABASE_URL=postgres://k:k@localhost/k npx knip         # 0
pnpm turbo boundaries                                    # 2,020 files, 31 packages, clean
pnpm build --concurrency=1                               # read the exit code
```

**Closed — money, security, data.** The neon-http driver throws on
transactions, so every mobile category drag-reorder had 500'd since the
endpoint shipped (now one `db.batch`, with a source scan refusing the shape
package-wide). The dispute-evidence split left apps/web's staff branch behind
a capability-less `requireStaff` with the preview route defaulting to it —
seller-only now. `saveFlow` destroyed a seller's email copy on a *refused*
save; validation now completes before the first write. Dispute evidence
narratives rebuilt `cents/100` five times, stating a ¥100,000 dispute as
"1000.00 JPY" to the card issuer. The abandoned-checkout tile summed
pre-discount presentment-currency baskets into a shop-currency figure; the
recovery email did the same and promised fixed coupons the presentment
checkout refuses; `announceAbandonments` claimed the whole backlog unbounded
inside a 60-second cron and enrolled buyers who had already paid over the
chat rail. The ship gates read `order.productKind` — the header's first line,
this module's eighth bug — leaving mixed baskets impossible to mark shipped.
REST and webhooks serialized legacy orders with `items: []`.

**Load.** Migration `0062`: the orders keyset 0060 skipped, the dashboard's
open-tail partial (whose predicate matched every order a no-affiliate shop
ever took), status tabs, affiliate and email-filter indexes, the funnel and
flows-tile date pairs, the better-auth FK indexes, and `stripe_events`
retention (a new prune in the sweep cron — the one table nothing bounded).
HQ's platform screens moved to the read replica with their own allowlist
test; `clients.list` aggregates the visible page instead of the shop's
lifetime; the visit beacon pays one validation read instead of two.

**DRY.** One home each for: evidence text helpers, `formatBytes` (the same
file read "4.3 MB" and "4.5 MB" on two screens), the client-IP parser, the
web origin (eleven raw env reads, three fallbacks), basis-point percentages,
the ILIKE escape, the search-param collapse, `initials` (one shop, two
monograms), the campaign and affiliate status tones, the subscription status
vocabulary, the `server-only` vitest stub (×5), and the cross-package test
doubles. ~15 redundant test cases deleted where the rule is pinned at its
home; the currency-table audit moved from apps/web into core beside the table.

**Still open, ranked.**

| # | What | Why not yet |
|---|---|---|
| 1 | ~~`0062` must be applied before this tree's dashboard predicate ships~~ | **Applied to production 2026-08-20**, each CREATE as CONCURRENTLY over the direct (non-pooler) endpoint, all twelve confirmed VALID before the two redundant prefixes were dropped. The tree was pushed after, in that order on purpose. The visit beacon's liveness read now also answers from the storefront's own `shopTag` cache, so what remains on the primary per pageview is the one insert the endpoint exists for. |
| 2 | Rate limits fail open when Redis is cold | Unchanged product decision from §3. |
| 3 | apps/web still imports `stripe` in four modules and `@vercel/blob` beside `@sailo/storage` | Seam-completion on the money path; gated on the checkout e2e suite per house rules. |
| 4 | REST `keysetWhere`/`paginate` vs commerce `olderThan`/`pageOf` remain two drizzle halves | The dangerous half (the codec) is unified; merging tested halves is churn without a bug. |
| 5 | `roster.ts` aggregates lifetime orders because it *sorts* by `max(created_at)` | Wants denormalized `clients.last_order_at`/counters — a feature, not a cleanup. |
| 6 | Cart sessions never match product-filtered `checkout.abandoned` flows | Sessions don't record cart lines; guessing would email the wrong buyers. Documented at both code sites. |
| 7 | Affiliate source labels are English on a 34-language page | Three keys through the i18n batch tooling. |
| 8 | Scenario suites not run this pass | No local DB infra in this session; unit/typecheck/lint/knip/boundaries/build were the verified gates. |
