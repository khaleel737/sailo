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

| # | Where | What | Why not today |
|---|---|---|---|
| 1 | `booking/availability.ts` | **Concurrent double-booking.** The slot is re-derived but the check and the order insert are separate statements. Intra-basket is closed; two simultaneous buyers is not. | Needs a DB constraint, and a plain unique index is wrong — a cancelled order releases its slot, and a partial index on `order_items` cannot see `orders.status`. Needs design, and a migration run before the code ships (§5). |
| 2 | `inventory.ts:293` | **Calendar squatting.** `releaseAbandonedCheckouts` sweeps card orders only, so an unpaid bank-transfer or COD booking holds its slot forever. | Bounded by the 10/min limit on `createOrderIntent`, and "unpaid manual order" is legitimately pending — the seller confirms by hand. Needs a product decision on when to expire one. |
| 3 | `connect.ts:257,271` | **Three-decimal rounding.** `toStripeAmount` rounds each line to a multiple of ten, but the `goodsTotal !== subtotalCents` guard compares unrounded values, so the charge can differ from the invoice by a few fils. | Small, real, and needs a decision about which side gives — round the order or round the lines. |
| 4 | `order-preview.ts:71`, `shop.ts:99` | **Two enumeration oracles.** A coupon code can be probed at 120/min, and `checkHandle` enumerates the seller roster. | Redemption caps still hold; both are throttled. Low value against the change required. |
| 5 | every `rateLimit` call | **All limits fail open** when Redis is missing or cold. | Deliberate and documented, but it means every ceiling above is absent in an environment without `REDIS_URL`. Worth a decision, not a silent default. |

---

## 4. Phase C — split by responsibility. **Not started.**

Measured now:

```bash
find src -name '*.ts' -o -name '*.tsx' | grep -v i18n/ | xargs wc -l | awk '$1>300' | sort -rn
```

| File | Lines | Verdict |
|---|---|---|
| `lib/stripe-webhooks.ts` | 680 | **Split first.** Clean seams already: verification (25–110), idempotency (112–132), ownership resolution (134–283), platform events (292–375), then connect events by family — session (393–575), charge (576–604), dispute (605–661), account (662–680). |
| `[handle]/_components/cart/checkout-panel.tsx` | 618 | Split by step, not by size. |
| `lib/actions/orders.ts` | 566 | Split after the above; it is the file most likely to move again. |
| `hq/(panel)/accounts/[id]/page.tsx` | 562 | Four tables in one page. |
| `lib/email/messages.ts` | 528 | Split by message. |
| `(marketing)/page.tsx` | 482 | Sections. |
| `[handle]/_components/cart/order-sheet.tsx` | 422 | |
| `lib/blog.ts` | 402 | Reviewed and hardened now, but never split. |
| `(legal)/terms,privacy,refunds` | 570/560/344 | **Leave whole.** Prose is data. |
| `lib/invoice-pdf.ts` | 318 | **Leave whole.** Positional layout — each section depends on the `y` the last one left. |
| `src/i18n/**` | — | **Leave whole.** Dictionaries are data. |

The method that works here is in HANDOFF.md and is worth following literally:
extract one seam, run `npx tsc --noEmit`, and **read what it says**. Nearly every
bug found by the previous split pass was surfaced by the compiler complaining
about an extraction, not by reading the file first.

---

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

## 6. The e2e gap — read this before trusting a green run

34 tests pass. **None of them places an order.** No e2e test calls
`createOrderIntent`, so none of the work on the checkout path — this session's or
the last — has been exercised end to end.

That is not an oversight. The Playwright dev server runs against `.env.local`,
whose `DATABASE_URL` is the **same Neon database production uses**. A test that
placed an order would write real rows, decrement real stock, and claim an invoice
number out of the sequence.

The fix is not "write the missing test". It is to give e2e a database it may
dirty:

1. A **Neon branch per run**, seeded from the demo fixtures, behind
   `E2E_DATABASE_URL`.
2. Then place an order on a manual rail — no Stripe needed — and assert the row,
   its lines, the reserved stock, the invoice number and the handoff message.
   That one test covers more of the money path than the whole current suite.
3. Card orders need Stripe test mode and a forwarded webhook. Worth it, after
   the manual rail proves the shape.

Until that exists the money path is carried by unit tests of its pure rules. That
is less than it sounds, and this document should not pretend otherwise.
