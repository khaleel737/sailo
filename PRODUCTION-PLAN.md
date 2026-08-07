# Sailo — production hardening plan

Written 2026-08-07, after a day of bug-fixing, two adversarial reviews and a
fresh knowledge graph of `src/`. Every number here was measured, not estimated;
the commands that produced them are in each section so they can be re-run.

This plan exists because the previous one was a to-do list. A to-do list does
not tell you *why* the same class of bug keeps coming back. The graph does.

---

## 1. Where it actually stands

```bash
npx vitest run                                   # 909 tests, 51 files
npx tsc --noEmit; echo $?                        # 0
npx oxlint 2>&1 | grep -cE '^src.*error'         # 0
npm run build > /dev/null 2>&1; echo $?          # 0
npx playwright test e2e/                         # 20/20, local and vs production
git worktree add /tmp/x HEAD && cd /tmp/x && npm ci && npm run build   # 0
```

| | Start of day | Now |
|---|---|---|
| Tests | 682 | **909** |
| Type errors | 0 | 0 |
| Lint errors | 13 | **0** |
| Known open bugs | 9 | **0 from that list; 6 new, from review** |
| Fresh-clone build | never verified | **exit 0** |

All eleven bugs on the old list are closed. Two adversarial reviews then found
fifteen defects *in those fixes*; eight are fixed, six remain open and are
listed in §3. That ratio is the single most important fact in this document.

---

## 2. What the graph says, and why it matters

```bash
/graphify src        # 2085 nodes, 7367 edges, 83 communities
```

**God node: `getDb()`, degree 217, across 59 files (52 in `lib/`, 6 in `app/`).**

Every layer opens its own database handle. There is no data-access seam, and
that is not a style complaint — it is the direct cause of the hardest bugs
found today. `neon-http` cannot do interactive transactions (`db.transaction()`
throws), so every multi-step write is a hand-rolled compensating rollback. With
217 call sites there is nowhere to put a transaction boundary even if the
driver supported one, so each rollback is written by hand, at the call site, and
each one is written slightly differently. Three of the six open findings are
exactly this: a compensator that forgets `restockedAt`, a step with no
compensator, a release that only fires on one of four failure paths.

**Cohesion of every large community is 0.05–0.13.** The clusterer cannot find
tight modules because there aren't any. Communities 0–2 (105, 102, 85 nodes) are
admin UI that shares nothing but imports.

The other god nodes are healthier and should be left alone: `requireShop()` (92)
is the authorization boundary and *should* be a chokepoint; `cn()` (136),
`formatMoney()` (90) and `interpolate()` (73) are leaf utilities.

**Conclusion that drives the rest of this plan:** splitting files by line count
is cosmetic. The seam worth cutting is `getDb()`.

---

## 3. Open findings, ranked

From the xhigh workflow review. Each is confirmed by reading the code.

| # | Where | What |
|---|---|---|
| 1 | `orders.ts:415` | Confirmation email sends before the buyer pays. `handOffToStripe` only creates a Checkout Session; an abandoned checkout keeps an un-recallable "your order landed" with a live download link, for an order the sweep then cancels. |
| 2 | `orders.ts:377` | Coupon released on one of four failure paths. Expiry, async failure and the sweep all cancel the order without giving the use back, so a one-use code is burnt by any abandonment. |
| 3 | `orders.ts:413` | Invoice number claimed before payment, so abandonment still gaps the sequence. Only the Stripe-API-failure case was closed. |
| 4 | `orders.ts:379` | Compensators call `releaseStockFor`, which adds units back without claiming `restockedAt`. A failed delete leaves a row the sweep restocks a second time — permanent stock inflation. |
| 5 | `orders.ts:315` | The `orderItems` insert has no compensator. A throw there leaves a header row with no lines, and `stockLinesFor` then attributes every unit to the header product. |
| 6 | `stripe-webhooks.ts:379` | `no_payment_required` (a 100%-off coupon) is treated as money in flight and stranded in `pending` forever — never confirmed, never delivered, never swept. |

**1, 2 and 3 are one fix.** All three are "this happens at checkout when it
should happen when the money actually arrives." They belong on the
`checkout.session.completed` webhook, not in `createOrderIntent`. Reordering
that function again will not close them — that was the mistake made today.

**4 and 5 are one fix**, and they are the `getDb()` problem in miniature.

---

## 4. Sequence

Each phase ends with the full gate: `tsc` → `vitest` → `build` → `oxlint` →
`playwright` (local **and** `E2E_BASE_URL=https://sailo.store`). Commit per
seam, push per commit.

### Phase A — close the six (ship-blocking)

1. **Move settlement side effects onto the webhook.** Invoice number,
   confirmation email and coupon commit move to where payment is confirmed.
   `createOrderIntent` keeps only what a payable order needs: stock, the order
   row, its lines, the session. Closes findings 1–3.
2. **One compensator, not five.** Every rollback path goes through
   `restoreStock`, which claims `restockedAt` and is therefore idempotent.
   Closes 4–5.
3. **Handle `no_payment_required` explicitly** as settled, not in-flight.
   Closes 6.

### Phase B — a transaction-capable client for the write path

**This replaces the "introduce a repository port" plan, which was wrong.** A
port over `getDb()` would not have produced a single transaction: the
constraint is the driver, not the call sites, and no number of layers above
`neon-http` makes it interactive. It would have added indirection and changed
nothing about the bug class — a shallow module in Ousterhout's sense.

Verified against the real database rather than assumed:

```
INTERACTIVE TRANSACTION: supported (rolled back cleanly)
```

`@neondatabase/serverless@1.1.0` exports `Pool`, `drizzle-orm/neon-serverless`
is present, and Node 22+ supplies a native `WebSocket`, so no `ws` dependency
is needed. A probe that read a value, branched on it in JavaScript, wrote, and
threw to roll back succeeded — the exact read-then-decide-then-write shape
`neon-http` cannot express.

The design, when it is done:

- Keep `getDb()` (`neon-http`) for everything it is good at — reads and
  single-statement writes, which is the overwhelming majority of the 217 sites.
  It is cheaper: no connection to establish.
- Add a **second** client, pooled and transaction-capable, used only where
  read-then-decide-then-write must be atomic. Today that is exactly one place:
  `reserveStock` → order + lines → coupon claim.
- Pool sized per `conn-pool-sizing-for-serverless`: `max: 10, min: 1,
  idleTimeoutMillis: 5_000`, a `globalThis` guard so dev HMR does not leak
  pools, and `attachDatabasePool` from `@vercel/functions` (**not currently a
  dependency — adding it is part of this phase**) so a suspending instance does
  not strand connections open on Postgres.
- **Stripe stays outside the transaction.** Per `tx-no-external-io-inside`, a
  transaction pins a backend connection for its whole body; a 400 ms call to a
  payment provider inside one drains the pool under load, and an external call
  cannot be rolled back anyway. The handoff runs after commit, and
  `abandonOrder` remains the undo for a failure there.

**Deferred deliberately, and this is the point of writing it down.** The bugs
this would prevent are already fixed — `db.batch()` made the header and its
lines atomic and `abandonOrder` unified the undo. What remains is a real but
modest gain, against the deployment risk of a new connection model: different
failure modes, Neon connection ceilings, and a new dependency, on the same day
as everything else here. It gets its own day and its own gate, not a corner of
this one.

### Phase C — split by responsibility

Only after B, because B changes what the seams are.

| File | Lines | Verdict |
|---|---|---|
| `lib/actions/orders.ts` | **724** | Split. It grew by 66 lines today *while being fixed* — the clearest possible sign the responsibilities are tangled. |
| `lib/stripe-webhooks.ts` | 607 | Split by event family: session, charge, dispute, subscription. |
| `app/[handle]/.../checkout-panel.tsx` | 582 | Split by step, not by size. |
| `app/hq/accounts/[id]/page.tsx` | 562 | Split — four tables in one page. |
| `lib/blog.ts` | 406 | **Never reviewed, split or hardened.** Read it first. |
| `(legal)/terms,privacy,refunds` | 570/560/344 | **Leave whole.** Prose is data. |
| `src/i18n/**` | — | **Leave whole.** Dictionaries are data. |

### Phase C½ — delete what nothing uses

Not a separate pass. **Every split, extraction and refactor carries its own
cleanup**, because the moment to find dead code is when you have just moved the
thing next to it. Doing it as a sweep later means reading the same files twice.

Measured, not guessed:

```bash
DATABASE_URL="postgres://knip:knip@localhost/knip" npx knip
```

| | Baseline (no config) | With `knip.json` |
|---|---|---|
| Unused files | 4 | **0** |
| Unused exports | 94 | **27** |
| Unused exported types | 28 | **7** |

Two thirds of the baseline was noise: `drizzle.config.ts` could not load without
`DATABASE_URL`, so the Drizzle plugin never ran and all fifteen `*Relations`
were reported dead — they are consumed by Drizzle at runtime and deleting them
would break every `with:` query. `knip.json` is committed so the number is
reproducible and can go into CI.

**Never auto-fix this.** The one-line proof: knip reports `tailwindcss` as an
unused devDependency, because it cannot follow `.css` and the import is
`@import "tailwindcss"` in `globals.css`. Removing it deletes every style in
the product. `knip --fix` would have done it.

What the 27 actually are, once traced:

- **Genuinely dead components** — `SailoWordmark`, `SailoBadge`, `Rule`,
  `SectionHeader`, `StatusDot`, `InputGroup`, `Checkbox`, `StateLabel`. Each is
  referenced only by the file that defines it.
- **Dead halves of duplicated components** — the more interesting group, and
  the same drift that produced two `ORDER_STATUSES` and two `ORDER_STATUS_TONE`.
  `Skeleton` exists in `ui/feedback.tsx` *and* `shared/skeleton.tsx`; ten
  `loading.tsx` files import the shared one, so the other is dead. `TitleCell`
  is the same story across `hq-table.tsx` and `shared/table.tsx`. Delete the
  copy, keep the one with callers — and check the two had not already diverged.
- **Unwired features** — `clearRefund`, `syncSubscription`,
  `togglePaymentMethod`, `getInvoiceForOrder`, `getAffiliateByCode`. Server
  actions and queries with no caller. These are *not* obviously deletable:
  each is either an unfinished feature or a genuinely orphaned one, and that is
  a product question. Confirm before removing; do not assume.
- **Barrel re-exports with no consumer** — `Sheet` and `ConfirmDialog` from
  `overlays/index.ts`, where callers import from `ui/index.ts` instead. Two
  barrels exporting the same component is the same duplication in another shape.

Three unlisted dependencies (`dotenv`, `playwright` ×2) are real and should be
declared rather than relied on transitively.

**The rule, applied to every commit from here:**

1. Run `knip` over what you touched before you commit it.
2. Delete the dead export in the same commit as the change that orphaned it —
   never "later".
3. Remove the imports it leaves behind; `oxlint` catches those, so lint clean
   is part of the gate already.
4. If a test only existed to cover deleted code, delete the test. A test that
   asserts nothing reachable is worse than no test: it makes the suite look
   larger than the coverage is.
5. **Write the new tests small.** Test the extracted unit, not the caller that
   used to contain it — that is the whole point of extracting it. A test that
   still needs the surrounding function is a sign the seam was cut in the wrong
   place.
6. Never delete on knip's word alone. Trace the symbol first; `.css`, runtime
   registries and framework conventions are all invisible to it.

### The e2e gap — read this before trusting a green run

`e2e/checkout.spec.ts` has seven tests. All seven open the checkout panel and
assert that it renders: it shows a total, it lists the rails, it closes on
Escape. **Not one of them places an order.** No e2e test in this repo calls
`createOrderIntent`, and therefore none of today's work on it — the reorder,
the batch insert, the compensators, the settlement move — was ever exercised
end to end. Every "e2e green" claim made while changing that function meant
"the panel still renders", and nothing more.

The omission is not an oversight. The Playwright dev server runs against
`.env.local`, whose `DATABASE_URL` is the **same Neon database production
uses**. A browser test that placed an order would write real rows, decrement
real stock, and claim an invoice number out of the sequence this plan spent a
day making unbroken.

So the fix is not "write the missing test" — it is to give e2e a database it is
allowed to dirty:

1. A **Neon branch per e2e run** (branching is cheap and instant, which is the
   feature's whole point), seeded from the demo fixtures, with `E2E_DATABASE_URL`
   pointing at it.
2. Then the tests worth having: place an order on a manual rail — no Stripe
   needed — and assert the row, its lines, the reserved stock, the invoice
   number and the handoff message. That single test covers more of the money
   path than the whole current suite.
3. Card orders need Stripe's test mode and a forwarded webhook; worth it, but
   after the manual rail proves the shape.

Until that exists, the money path is carried by unit tests of its pure rules and
by source-level tests of its wiring. That is genuinely less than it sounds, and
the plan should not pretend otherwise.

### Phase D — security, with tools rather than reading

1. `threat-model` over checkout, auth and the webhooks — **never run**, and
   HANDOFF.md names it as the reason the last hardening pass missed nine bugs.
2. `threat-patch` for what it surfaces.
3. Add **Semgrep** to CI. Of ~14 skills recommended by the sources reviewed,
   eleven are already installed here and two target a different stack
   (Cloudflare Workers, Clerk); the only genuinely additive one is static
   analysis, and that is a tool, not a prompt. `npx semgrep --config auto src/`
   as a gate is worth more than another skill file.
4. Re-run the fee/copy audit: production currently tells visitors Sailo takes
   no cut of their sales, in English and 34 other languages, while 0.5% is
   charged on every card sale. `pricing.body` needs the `{fee}` placeholder in
   each dictionary, and three call sites need `interpolate()`.

---

## 5. Rules this codebase earned today

Beyond the four in HANDOFF.md, which still hold.

- **Before moving code, check what it will now run behind.** If that is on the
  open-bug list, fix it first. Two fixes today were made *over* an open bug
  (stock reservation, finding 4) and one created a new hole by combining with
  another (`submitPaymentReference` + the sweep predicate).
- **A comment asserting a guarantee is a claim that gets tested.** Three
  comments written today were false: "the money has already moved", "every
  failure here is logged and swallowed", "the sweep can find the order". Each
  described the intent rather than the code.
- **A test that reads its own source can match its own comment.** Four tests
  written today asserted prose instead of behaviour. Strip comments before
  asserting on source, and never name a property the test does not exercise.
- **Verify by exit code.** `vitest run | tail -3` prints timings and hides the
  result line; a broken test was shipped that way. `npm run build` with a
  symlinked `node_modules` reports success while Turbopack fails.
- **The reviewer's scope is not your scope.** A clean review of one agent's
  files says nothing about yours. Both statements of "zero findings" made today
  were wrong for this reason.
