# Sailo — production hardening plan

Rewritten 2026-08-07 after a security audit and fifteen fixes. Every number was
measured with the command beside it, not estimated. Re-measure before planning:
this repo has more than one agent in it and the numbers move.

---

## 1. Where it stands

```bash
npx tsc --noEmit; echo $?                              # 0
npx vitest run                                         # 1206 tests, 59 files
npx vitest run --config vitest.scenarios.mts           # 48 against a real database
npx oxlint 2>&1 | grep -cE ' error '                   # 0
npm run build > /dev/null 2>&1; echo $?                # 0
npx playwright test e2e/                               # 34/34
E2E_BASE_URL=https://sailo.store npx playwright test e2e/security.spec.ts e2e/checkout.spec.ts
DATABASE_URL=postgres://k:k@localhost/k npx knip       # 0 unused files, 0 unused exports
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
was production's. `scripts/scenarios/up.sh` now gives it one it may dirty, and
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

| # | Where | What | Why not yet |
|---|---|---|---|
| 1 | `inventory.ts` | **Calendar squatting.** The sweep reclaims card orders only, so an unpaid transfer or COD booking holds its slot until the seller cancels it. | Bounded by the 10/min limit on `createOrderIntent`, and "unpaid manual order" is legitimately pending — the seller confirms by hand. Needs a product decision on when one expires. |
| 2 | `order-preview.ts`, `shop.ts:99` | **Two enumeration oracles** — a coupon code can be probed at 120/min, and `checkHandle` enumerates the seller roster. | Throttled; redemption caps still hold. Low value against the change. |
| 3 | every `rateLimit` call | **All limits fail open** when Redis is missing or cold. | Deliberate and documented, but it means every ceiling is absent in an environment with no `REDIS_URL`. Worth a decision rather than a silent default. |
| 4 | `queries/products.ts:64` | **`?q=` is a leading-wildcard `ILIKE`** with no trigram index — a per-shop scan. | Fine at hundreds of products, will crawl on a 10k-product catalogue. Length is capped and the endpoint is throttled, so it is a scaling item, not an abuse one. |

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

That is now worked around rather than lived with. `scripts/scenarios/up.sh`
starts a throwaway Postgres behind a local Neon HTTP proxy — the proxy is the
load-bearing part, because the app speaks Neon's HTTP protocol and a plain
container cannot answer it — and `vitest.scenarios.mts` points the app's own
`getDb()` at it with no change to application code:

```bash
./scripts/scenarios/up.sh
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
