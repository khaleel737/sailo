# Sailo — production hardening plan

Rewritten 2026-08-07 after a security audit and fifteen fixes. Every number was
measured with the command beside it, not estimated. Re-measure before planning:
this repo has more than one agent in it and the numbers move.

---

## 1. Where it stands

```bash
npx tsc --noEmit; echo $?                        # 0
npx vitest run                                   # 1194 tests, 58 files
npx oxlint 2>&1 | grep -cE ' error '             # 0
npm run build > /dev/null 2>&1; echo $?          # 0
npx playwright test e2e/                         # 34/34
DATABASE_URL=postgres://k:k@localhost/k npx knip # 0 unused files, 0 unused exports
```

| | Previous | Now |
|---|---|---|
| Tests | 909 | **1194** |
| Type errors | 0 | 0 |
| Lint errors | 0 | 0 |
| Unused exports (knip) | 27 | **0** |
| Unlisted dependencies | 3 | **0** |
| Open findings from §3 | 6 | **0** |
| Security findings from the audit | — | **15 closed, 5 open (§3)** |

The six ship-blocking findings in the previous version of this document are all
closed in the code — verified by reading it, not by trusting the commit
messages. Settlement side effects are on the webhook, `abandonOrder` is the one
compensator, `no_payment_required` is treated as settled.

---

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
| 1 | `booking/availability.ts` | **Concurrent double-booking.** The slot is re-derived but the check and the insert are separate statements. Intra-basket is closed; two simultaneous buyers is not. | Needs a DB constraint, and a plain unique index is wrong — a cancelled order releases its slot, and a partial index on `order_items` cannot see `orders.status`. Needs design and a migration run before the code ships (§5). |
| 2 | `inventory.ts` | **Calendar squatting.** The sweep handles card orders only, so an unpaid transfer or COD booking holds its slot. | Bounded by the 10/min limit on `createOrderIntent`; "unpaid manual order" is legitimately pending. Needs a product decision on when one expires. |
| 3 | `connect.ts:257,271` | **Three-decimal rounding.** Lines round to a multiple of ten, the guard compares unrounded, so the charge can differ from the invoice by a few fils. | Needs a decision on which side gives. |
| 4 | `order-preview.ts`, `shop.ts:99` | **Two enumeration oracles** — coupon probing at 120/min, handle enumeration. | Throttled, caps still hold. Low value against the change. |
| 5 | every `rateLimit` call | **All limits fail open** without Redis. | Deliberate, but it means every ceiling is absent in an environment with no `REDIS_URL`. Worth a decision, not a silent default. |
| 6 | `queries/products.ts`, `queries/orders.ts` | **Unbounded admin reads.** `getAdminProducts` loads a whole catalogue with relations; `getShopClients` aggregates every client × order. | Seller-only traffic; will time out for one big shop before it costs anyone else. Paginate. |
| 7 | `resolve-lines.ts:58` | **N+1 on the checkout quote** — two queries per basket line, sequential, re-fired on every basket change. | ~100–300ms on a five-line cart. `inArray` collapses it to two queries; not done. |
| 8 | `hq/overview.ts` | **`/hq` aggregates run on the primary**, unwindowed, though `db/index.ts` says these belong on the replica. | Two staff users. Low frequency, real cost per load. |

---

## 4. Phase C — split by responsibility. **Started.**

| File | Was | Now | State |
|---|---|---|---|
| `lib/stripe-webhooks.ts` | 680 | 5 modules, largest 321 | **Done.** Split by the question each part answers; `ownership` is the security seam and now has its own file and header. |
| `[handle]/.../checkout-panel.tsx` | 618 | 545 + a 126-line hook | **Partly.** `useCheckoutQuote` owns the server conversation. The form is the next cut, by step. |
| `lib/actions/orders.ts` | 566 | 566 | Not started. |
| `hq/(panel)/accounts/[id]/page.tsx` | 562 | 562 | Not started — four tables in one page. |
| `lib/email/messages.ts` | 528 | 528 | Not started — split by message. |
| `(marketing)/page.tsx` | 482 | 482 | Not started — sections. |
| `lib/blog.ts` | 402 | 402 | Reviewed and hardened, never split. |
| `(legal)/terms,privacy,refunds` | 570/560/344 | — | **Leave whole.** Prose is data. |
| `lib/invoice-pdf.ts` | 318 | — | **Leave whole.** Positional layout; each section depends on the `y` the last one left. |
| `src/i18n/**` | — | — | **Leave whole.** Dictionaries are data. |

The method that works: extract one seam, run `npx tsc --noEmit`, and **read what it says**. Splitting the webhooks turned three accidentally-private functions into a real boundary, and lifting the checkout's quote found `couponFor` being called twice with nothing making the two agree.

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
