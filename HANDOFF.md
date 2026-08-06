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
- Skills live in **`.claude/skills/`** (project, not `~/.claude/skills/`).
  Relevant: `clean-code-ts-react`, `next-best-practices`, `nextjs`,
  `nextjs-ppr-patterns`, `ast-grep-typescript-react`, `drizzle-nextjs-postgres`,
  `frontend-design`. Load them with the Skill tool before the work they cover.
- `stripe-best-practices` (user-level skill) for anything touching payments.

## Where it stands (measured, not estimated)

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

## Open bugs, found by audit and NOT yet fixed

Ranked. Each has been verified by reading the code, not guessed.

1. **Mixed basket digital files never deliver.** `src/lib/downloads.ts:94`
   gates on `order.productKind`, which is the *header* column set from the
   first line only (`actions/orders.ts:236`), while `downloadToken` is issued
   whenever *any* line is digital. Buy a mug + a PDF: token exists,
   `productKind === "physical"`, and every caller of `releaseDownloads`
   (webhook, seller dropdown, `clearRefund`) returns false forever. Buyer pays,
   files held permanently, no manual fix exists. Use `orderLines` /
   `orderedProductIds` — `filesForOrder` two functions below already does.

2. **Refunds are not capped by prior refunds.** `actions/order-admin.ts:173,211`
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

Report honestly: if a test you wrote was wrong rather than the code, say so.
If a file shouldn't be split, say why instead of splitting it badly.
