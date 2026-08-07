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

### Phase B — cut the seam the graph found

Introduce a repository boundary for the order lifecycle only — not a
codebase-wide abstraction. `lib/orders/*` stops calling `getDb()` and takes a
narrow port instead. This is what makes a real transaction possible later, and
what makes the compensators testable without a database. Success is measured,
not asserted: `getDb()` call sites in `lib/orders/**` reach **zero**.

Do **not** generalise this to admin, hq or analytics in the same pass. A
repository over 217 call sites written in one go is a bigger risk than the bugs
it prevents.

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
