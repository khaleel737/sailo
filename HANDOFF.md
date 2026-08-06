# Sailo — continuation prompt

Copy everything below the line into a fresh agent session.

---

You are continuing a long refactor, test and hardening effort on **Sailo**, a
link-in-bio product catalogue ("Linktree, but the rows are products").
Next.js 16 App Router + Turbopack, React 19, TypeScript strict, Tailwind v4,
Neon Postgres + Drizzle, BetterAuth, Stripe (platform subscriptions + Connect
for sellers). Repo `/Users/khaleelmusleh/Desktop/Shopik`, deployed to
https://sailo.store on every push to `main`.

The goal is a codebase that can take real users and real money.

## Read these first

- `AGENTS.md` — **this Next.js has breaking changes from your training data.**
  Read `node_modules/next/dist/docs/` before writing anything version-sensitive.

### Skills — 252 are installed in `.claude/skills/` (project, NOT `~/.claude/skills/`)

Load with the Skill tool **before** the work it covers, not after. The ones
that matter here, and when:

| When you are… | Load |
|---|---|
| Splitting a component or naming an extraction | `clean-code-ts-react`, `react-composition`, `react-refactor` |
| Writing or changing anything Next-specific | `nextjs`, `next-best-practices`, `nextjs-ppr-patterns` |
| Touching types, generics, narrowing, `satisfies` | `typescript`, `typescript-advanced-patterns`, `typescript-refactor` |
| Writing React that holds state | `react`, `react-best-practices`, `react-optimise` |
| A mechanical rename or codemod across many files | `ast-grep-typescript-react`, `refactor` |
| Writing tests | `tdd`, `vitest`, `react-testing-library`, `playwright` |
| **Auditing for vulnerabilities / pentesting** | **`threat-model`**, then **`threat-patch`** to fix what it finds |
| **Reviewing your own diff before committing** | **`code-reviewer`**, **`bug-review`** |
| Anything touching Drizzle or the schema | `drizzle-nextjs-postgres` |
| Anything touching Stripe | `stripe-best-practices` (user-level) |
| Validation / parsing untrusted input | `zod`, `adversarial-zod` |
| Auth, sessions, guards | `better-auth` |
| Performance or bundle size | `nextjs-bundle-optimizer`, `algorithmic-complexity-review` |
| SEO / metadata | `nextjs-seo` |

**Run `threat-model` over the payment and auth paths as part of Phase 3.** It
was never run last session — Phase 3 was done by hand, which is why the audit
that followed still found nine bugs.

**Run `code-reviewer` on your own staged diff before every commit on the money
path.** Cheaper than finding it in production.

Browse the rest with `ls .claude/skills/` — there is likely one for whatever
you are about to do by hand.

## Where it stands

Measured at commit 1960667. **Re-measure before planning** — this repo has two
agents working in it and the numbers move:

```bash
find src -name '*.ts' -o -name '*.tsx' | wc -l
npx vitest run 2>&1 | grep -E 'Tests '
npx tsc --noEmit 2>&1 | grep -c 'error TS'
npx oxlint 2>&1 | grep -cE ' error '
find src -name '*.ts' -o -name '*.tsx' | grep -v i18n/ | xargs wc -l | awk '$1>300' | sort -rn
```


| | |
|---|---|
| Source files | 541 (`src/**/*.ts,tsx`), ~87,000 lines |
| Routes / API routes / server-action files | 47 / 12 / 16 |
| Tests | **682** across 46 files |
| Type errors | **0** |
| Lint errors (oxlint) | **13** — 10 non-null assertions, 2 mutating sorts, 1 class |
| Files >300 lines (real code) | **20** |
| Colocation | every route has `_components`/`_lib`; 43 genuinely shared components remain in `src/components` |

## Phases — 1–3 were completed once; new code has re-opened them

**Phase 1 — Route colocation.** Was complete. Re-verify: every route's
components live under that route's `_components`, `_lib`, `_types`. Only
genuinely cross-section pieces belong in `src/components/{ui,shared,overlays}`.

**Phase 2 — Split by responsibility.** 20 files are back over 300 lines:

```
lib/actions/orders.ts               638   createOrderIntent, ~450 lines in one function
app/[handle]/.../checkout-panel.tsx 582
app/(legal)/terms/page.tsx          570   prose — data, leave it
app/hq/accounts/[id]/page.tsx       562
app/(legal)/privacy/page.tsx        560   prose — data, leave it
lib/stripe-webhooks.ts              541
app/(marketing)/page.tsx            478
app/[handle]/.../order-sheet.tsx    424
lib/blog.ts                         406   NEW — never reviewed
app/hq/page.tsx                     383
app/[handle]/p/[slug]/page.tsx      382
lib/connect.ts                      381
...and 8 more
```

Legal prose and `src/i18n/**` dictionaries are **data, not logic** — do not
split them.

**Phase 3 — Hardening.** Done once: rate limits on every public write, route
guards audited, egress endpoints checked, dependency audit, webhook signature
verification, CSP + security headers. **New code has not been through this.**

**Phase 4 — Production.** Not formally done.

## Known bugs — 9 open, 2 already fixed

Ranked, each verified by reading the code rather than guessed. **This list is
what was found last time, not the whole truth — the audits above are how you
find what is not on it.** New code has never been audited at all.

~~1. Mixed basket digital files never deliver.~~ **FIXED** (commit 1960667) —
   `hasReleasableDownloads` now gates on the token alone. Left here so you can
   see the shape of the bug; do not re-fix it.

   Original: **Mixed basket digital files never deliver.** `src/lib/downloads.ts:94`
   gates on `order.productKind`, which is the *header* column set from the
   first line only (`actions/orders.ts:236`), while `downloadToken` is issued
   whenever *any* line is digital. Buy a mug + a PDF: token exists,
   `productKind === "physical"`, and every caller of `releaseDownloads`
   (webhook, seller dropdown, `clearRefund`) returns false forever. Buyer pays,
   files held permanently, no manual fix exists. Use `orderLines` /
   `orderedProductIds` — `filesForOrder` two functions below already does.

~~2. Refunds are not capped by prior refunds.~~ **FIXED** (commit 1960667) —
   `checkRefund` caps against what is left and accumulates. Do not re-fix.

   Original: **Refunds are not capped by prior refunds.** `actions/order-admin.ts:173,211`
   guards `requested > order.totalCents` but never reads `refundedCents`, and
   writes `refundedCents: requested` (assignment, not accumulation). Two $50
   refunds on a $100 order move $100 at Stripe and record $50.

3. **`charge.refunded` webhook not scoped to the sending account.**
   `stripe-webhooks.ts:437` looks up by `stripePaymentIntentId` alone. Every
   sibling handler (`orderForSession`, `orderForCharge`) scopes to the account
   with a comment explaining why. A seller controlling their own connected
   account could mark another shop's order refunded.

4. **Six writes happen before the payment handoff can fail.**
   `actions/orders.ts:298–439`: items → coupon redemption → invoice →
   **confirmation email** → Stripe. On failure `orders/card-handoff.ts:67`
   restores stock and deletes the order, but the buyer already has a
   "confirmed" email with a now-404 invoice link, the coupon use is
   permanently burnt, and the invoice number sequence has a gap.

5. **`parseMoneyToCents("12,5")` → $125.00.** `lib/utils.ts:34` strips the
   comma. EUR/TRY/BRL/IDR sellers type decimal commas. Three money parsers
   exist with three conventions (`utils.ts`, `csv.ts:89`, `actions/shop.ts:179`).

6. **Stock reserved outside any transaction.** `actions/orders.ts:166–322`.
   A throw between reservation and the `orderItems` insert leaves units off
   the shelf with no order row — and `releaseAbandonedCheckouts`
   (`inventory.ts:232`) only sweeps rows that have a `stripeSessionId`, which
   isn't written until `card-handoff.ts:49`. Nothing ever reclaims them.

7. **`firstRow` on `onConflictDoNothing` inserts** — `orders/referral.ts:33`,
   `actions/affiliates.ts:205`, `lib/invoices.ts:45`. `firstRow` throws on
   empty; each site has unreachable recovery code proving `undefined` was
   expected. Use `maybeRow`. `referral.ts` is on the checkout path and throws
   *after* the order is written.

8. **A public action can clear a chargeback.** `actions/orders.ts:627`
   `submitPaymentReference` sets `paymentStatus: "pending"` on any non-paid
   order. `payments/status.ts:22` deliberately forbids sellers from clearing
   `disputed`; this unauthenticated action does exactly that.

9. **Coupon cap is read-then-write.** `actions/orders.ts:325` — the comment
   claims atomicity but there's no `where timesRedeemed < maxRedemptions`.
   Two simultaneous orders both redeem a one-use code.

10. **Platform fee charged on inclusive tax.** `lib/plans.ts:211` uses
    `subtotalCents - discountCents`, which contains VAT when `taxInclusive`.
    `pricing.ts:165` gets this right for affiliate commission.

11. **Restock/status disagree on `refunded`.** `inventory.ts:216` says
    cancelled *and* refunded release stock; `order-admin.ts:57` only restocks
    on `"cancelled"`.

## Untested modules with real business rules

`src/lib/quote.ts` (pricing composition — `cartNeedsDelivery`, `needsAddress`,
`unitCount`), `src/lib/staff.ts` (**the entire `/hq` authorization model** — its
own header says a unit test should exist and none does), `src/lib/csv.ts`
(`escapeField` is the formula-injection defence for every export),
`src/lib/cart.ts`, `src/lib/handle.ts` (`RESERVED_HANDLES` stops a shop
claiming `/admin`), `src/lib/payments/status.ts`, `src/lib/billing-map.ts`,
`src/lib/downloads.ts`, `src/lib/invoices.ts`, `src/lib/exporters.ts`,
`src/lib/stripe-webhooks.ts`, plus ~20 more listed by:

```bash
for f in src/lib/*.ts; do b=$(basename $f .ts); [ -f "src/lib/$b.test.ts" ] || echo $b; done
```

## Recurring bug patterns in this codebase — check new code for all four

1. **The order header is not the order.** `order.productId`, `productTitle`,
   `productKind`, `quantity` describe the *first line only*. Reading them as
   whole-order facts has caused **seven** bugs. `src/lib/order-lines.ts` is the
   only correct accessor.
2. **Blank is not zero.** An empty price means "inherit from the product"; `0`
   means free. Empty stock means untracked; `0` means sold out. Collapsing
   them costs money.
3. **A duplicated constant is a duplicated bug.** Order status tones, IP
   parsers, the tax label — each was copied, each drifted, each had to be
   unified. Grep before adding a constant.
4. **`!` hides something real.** 15 non-null assertions were removed; 5 were
   masking actual bugs. Treat each as a question.

## Working rules — these were learned the hard way

- **Verify by exit code, never by grepping build output.** `npm run build`
  prints "Failed to type check", not "Failed to compile" — a grep for the
  latter let a type error reach production.
- **Never bulk-regex TypeScript.** A regex deletion once removed
  `saveProduct` and two other exports; a rename broke three call sites.
  Use exact line ranges, verify with `tsc` after every edit.
- **`npx vitest run` does not typecheck.** Run `npx tsc --noEmit` separately.
- **Another agent may be working in this repo.** Stage only files you fully
  own. A one-line fix to someone else's file once committed their source
  without its `package.json` dependencies and broke the production build.
- **Scan `git diff --cached` for secrets before every commit**:
  `grep -ciE "sk_test_|sk_live_|whsec_|re_[A-Za-z0-9_]{20,}"`. Secrets live in
  `.env.local` (gitignored) and must never be echoed.
- **Push after each commit** rather than letting them stack — 17 once
  accumulated unpushed.
- Commit messages: explain *why*, name the bug the change prevents, no
  bullet lists of files changed.

## How to work — this matters as much as the list

**Start by auditing, not by fixing.** The eleven bugs below were found by
running three audit agents in parallel, not by reading files in order. Do the
same before touching anything:

```
Agent 1: every server action and API route in src/lib/actions/ and
         src/app/api/ — which write data without an ownership check
         (requireShop / requireStaff)? Which public writes have no rate limit?
Agent 2: money — floating point on cents, totals recomputed client-side and
         trusted, rounding that differs between two call sites, refund or
         commission paths that assign where they should accumulate.
Agent 3: everything added since commit 059dc43 — has it been split, tested,
         guarded? lib/blog.ts (406 lines) has never been reviewed at all.
```

Ask each for `file:line`, what breaks, and how a user would notice. Then
**verify every finding yourself by reading the code** before acting on it —
roughly one report in five is wrong, and acting on a wrong one wastes a commit.

**Per commit, without exception:**

```bash
npx tsc --noEmit                 # must be silent — vitest does NOT typecheck
npx vitest run                   # all green
npm run build > /dev/null 2>&1; echo $?   # must be 0 — read the CODE, not the output
npx oxlint <files you touched>   # clean
! git diff --cached | grep -qiE "sk_(test|live)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}" \
  && git commit ... && git push origin main
```

Touching the checkout or payment path additionally requires
`npx playwright test e2e/checkout.spec.ts` **before** the commit, not after a
batch of them.

**Push after every commit.** Do not let them stack.

**Fixing a bug means a test that fails before the fix and passes after.** If
the logic is buried in a function that needs a database, extract the decision
as a pure function and test that — `hasReleasableDownloads` and `checkRefund`
in commit 1960667 are the pattern to copy.

**When not to split a file:** legal prose, `src/i18n/**` dictionaries, and
positional layout code (`invoice-pdf.ts` draws a PDF where each section
depends on the `y` the last one left). Splitting those trades a real coupling
for a cosmetic one. Say so instead of doing it badly.

**Definition of done for a file:** under ~300 lines *or* a written reason why
it should stay whole; its pure logic tested; its route colocated; no non-null
assertions; lint clean.

## The loop, per file

This is the method that produced everything above. Follow it literally.

```
1. Read the file. Find the seams — usually a section comment, a Card, a
   table, or a block of pure logic trapped among effects.
2. Name what each seam IS, not where it sits. "What a digital product
   delivers and when the buyer gets it" is a component; "the second Card"
   is not.
3. Extract one seam. Exact line ranges — never a regex over TypeScript.
4. Run `npx tsc --noEmit`. READ WHAT IT SAYS. This is the bug-finding step.
5. Test the rule the seam encodes, not its implementation.
6. Load `code-reviewer` and review your own staged diff. Then gate,
   commit, push. One seam per commit.
```

**Step 4 is the point.** Nearly every bug found last session was surfaced by
extraction, not by reading:

- Pulling four tables out of the HQ page made tsc reveal that
  `getAccountDetail` returns a **union** — the shop-less branch had been
  narrowed by an early return the tables inherited invisibly.
- Moving the status badge exposed a **second copy** of `ORDER_STATUS_TONE`
  without its `satisfies` — a new status would compile in one place and go
  silently grey in the other.
- Extracting the variant image upload showed `json.url` read off an unchecked
  response: a malformed body set the image to `undefined`, which reads as
  "uploaded" and shows nothing.
- Lifting the file sync out showed `filter` narrows nothing, so the next line
  had to assert a URL the line above had just proved.

A file that extracts with zero compiler complaints was probably already fine.
A file that fights you is telling you something. **Do not paper over step 4 by
adding `!` or `as` — that is the signal, not the obstacle.**

## Definition of done, per phase

**Phase 1 — Colocation.** Done when every route's components live under that
route and `src/components/**` holds only what genuinely crosses sections.
Check: `ls src/components` should contain no folder named after one feature.

**Phase 2 — Split.** Done when every real-code file is under ~300 lines *or*
carries a written reason to stay whole, and the pure logic each one held is
importable and tested. Check: the `wc -l` command above, minus i18n and legal.

**Phase 3 — Harden.** Load `threat-model` and run it over the checkout, auth
and webhook paths — this was skipped last session and an audit afterwards
still found nine bugs, several of them exploitable. Use `threat-patch` for
what it surfaces.

Done when every server action and API route either has an ownership guard or
a written reason it is public; every public write has a rate limit; no
secret-bearing module is imported for its runtime value by a `"use client"`
file; `npm audit --omit=dev` is understood, not just run; and `threat-model`
reports nothing unaddressed on the payment path.

**Phase 4 — Production.** Done when a fresh clone (`git clone` → `npm ci` →
`npm run build`) exits 0, the checkout and security e2e suites pass against a
running server, and the nine open bugs are closed or consciously accepted.

## Suggested order

1. **Bugs 1–4 first.** They move money or break delivery for a paying buyer.
   One commit each, with a test that fails before the fix.
2. **Test `staff.ts`, `quote.ts`, `csv.ts`, `downloads.ts`.** Authorization
   and money, currently unguarded.
3. **`createOrderIntent`.** A prior audit produced this extraction order,
   safest first: result assembly (441–483, pure) → handoff payload (375–411,
   pure) → digital delivery (195–223) → notification fan-out (335–373) →
   persistence (225–330, *wrap in a transaction*) → stock reservation
   (160–193, owns its own rollback). One seam per commit; run
   `npx playwright test e2e/checkout.spec.ts` **between** each, not at the end.
4. **New code through Phase 2 and 3.** `lib/blog.ts` (406) has never been
   reviewed, split, or hardened.
5. **Clear the 13 lint errors.**

## Reporting

Say plainly what you did and did not do. If a test you wrote was wrong rather
than the code, say so — that happened repeatedly last session and admitting it
was faster than defending it. If a file should stay whole, give the reason
instead of splitting it badly. If a finding turned out to be wrong on
inspection, say that too rather than quietly dropping it.

Do not report "done" for work that was not verified by the gate above.
