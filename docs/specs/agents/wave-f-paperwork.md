# Wave F — Paperwork and content

You are one of six agents building the Sailo 2026-08 release in
`~/Desktop/Sailo`. You own **five** items: three obligations, one payout on work
already done, and gated content.

Migrations **0056–0059**. Claim each with a one-line commit to
`apps/web/drizzle/` before writing the SQL. F4 needs none.

**Order: F1 first (it is small and it closes a loop spec 44 left open), then
F2, F4, F3, F5.**

---

## F1 — Seller legal pages · S · `0056_shop_pages.sql`

`docs/specs/41-seller-legal-pages.md`. **New table:** `shop_pages`.

The smallest thing in the release, and it makes `requireTerms` usable — today a
seller can demand a buyer agree to a link they may not have.

> ### It closes a loop spec 44 deliberately left open
>
> `policySnapshotsForOrder` in `packages/commerce/src/disputes/policies.ts`
> currently resolves snapshots that already exist and **never fetches** — a
> checkout must not wait on a seller's own web host.
>
> Once `shop_pages` exists, snapshot `body_md` **directly**, with
> `source: "shop_page"`. That file already documents the three sources and why
> they are not equally trustworthy: a shop page is the *good* path, because the
> text is ours and cannot change under us — unlike a `termsUrl` an issuer
> follows four months later and finds rewritten. **A URL that changed is not
> evidence.**

English-only document, translated chrome. Seller-supplied URLs go through the
SSRF guard at the write.

---

## F2 — Buyer data requests, and the file sweep · M · `0057_data_requests.sql`

`docs/specs/52-buyer-data-requests.md`, **plus a TODO in no spec that this one
cannot honestly ship without.**

**New table:** `data_requests`.

### Build the sweep first

`README.md`, in *"Not built yet"*:

> The 90-day sweep for a deleted seller's product files. Deletion removes their
> images at once and keeps the files, because buyers who paid for a download
> still hold live tokens; **the cron that finally clears them is a TODO in
> `api/cron/sweep`.**

That is personal data with **no deletion path at all**, and this spec is about
to promise a statutory one. Shipping erasure on top of a store that cannot
actually erase is a promise worse than not making it.

Build the sweep, and make the window a named constant with the reason beside it
— the way `EVIDENCE_RETENTION_DAYS` in
`packages/core/src/disputes/messages.ts` names 400 days and says why.

### Then the requests

- **A statutory 30-day clock**, starting at verification rather than submission.
- **Verification before assembly, always.** Assembling somebody's order history
  and *then* checking who asked is how a data-protection feature becomes a
  breach.
- **The suppression list is never erased.** Erasing it re-subscribes somebody
  who asked to be left alone — the one "deletion" that does the opposite of what
  was asked. Say so in the response.
- **Spec 03 (account deletion) already ships and retains the ledger.** Read what
  it does before deciding what erasure means; the two must agree, and
  `shop_closures` is written *before* the tombstone — step order is
  load-bearing and retries must not thin it.
- **Decision B:** the request endpoint is an existence oracle — **fails closed**,
  answering the same sentence whether or not that email ever bought anything.

---

## F3 — Order evidence pack · L · no migration

`docs/specs/45-order-evidence-pack.md`. Turns seven of nine `needs_seller`
evidence slots into `held`. The payout on spec 44, which is **already built and
in the tree**.

> **Renders on demand from 44's immutable snapshot. Do not store a PDF per
> order.**

Everything you print already exists, exported from `@sailo/commerce/disputes`:

| What | Where |
|---|---|
| The policy the buyer agreed to | `policy_snapshots`, via `latestSnapshot` |
| Every message sent, as sent | `order_messages`, via `messagesForOrder` |
| Whether it arrived, and who said so | `orders.delivered_at` / `delivered_source` / `delivery_signed_by` |
| What their statement said | `orders.statement_descriptor` |
| Their sign-in history | `account_events`, via `accountHistory` |

New file: `packages/core/src/disputes/pack.ts`. Reuses
`apps/web/src/lib/invoice-pdf.ts` and `packages/core/src/disputes/assemble.ts`.

---

## F4 — Platform subscription disputes · M · `0058_platform_evidence.sql`

`docs/specs/46-platform-subscription-disputes.md`. Sailo stops losing its own
chargebacks uncontested. **New table:** `platform_usage_daily`.

**Spec 44 gave you the thing this could not be built on before:**
`account_events`, a sign-in history that outlives a better-auth session — which
expires and deletes exactly the evidence a 120-day-old subscription dispute
needs. Sailo's own policy snapshots are there too (`policy_snapshots` with
`shop_id IS NULL`).

**One loose end to close:** `snapshotPlatformPolicies()` in
`packages/commerce/src/disputes/policies.ts` is written, tested, and called by
nothing. Wire it into a deploy step.

> **Includes the rule that matters most: when the seller is right, refund rather
> than contest.**

---

## The rule F3 and F4 share, and it is absolute

Both render documents and submit them to a card network **in somebody else's
name**.

**Never state a fact Sailo does not hold.** A pack claiming "delivered" because
a seller ticked a box, or printing today's refund policy against a sale from
March, is a false claim to a bank made on the seller's behalf — it loses the
case *and* damages the person who submitted it. Every line carries its
provenance and its date.

`orders.delivered_source` exists precisely for this: `seller`,
`buyer_confirmed` and `carrier` are not equally persuasive and must never be
printed as though they were.

---

## F5 — Gated content collections · L · `0059_content_collections.sql`

`docs/specs/40-gated-content-collections.md`. **New tables:** `collections`,
`collection_items`, `content_progress`. Supersedes `deferred/18-ecourse.md` —
read that first to see what was deliberately dropped.

> ### Writes no new access predicate
>
> **If one appears in your diff, it is wrong.**
>
> `membershipAccess` is the single implementation of "may this buyer see this",
> and that property is why grace periods, the members list, the download gate,
> the door pass and cancellation all behave consistently without five copies of
> the rule drifting apart. Gated content asks the same question, so it asks the
> same function.
>
> **Wave C's spec 49 is under an identical constraint** — it may add exactly one
> branch and no more. Coordinate if you both need one.

"Course" is doing narrow work here: gated content with ordering and progress,
not a learning platform. **Decision B:** the progress write is a public write and
fails closed.

---

## Done when

A seller writes their own terms and every order after that records which version
the buyer agreed to; a buyer can ask what Sailo holds and have it actually
deleted; a chargeback is answered with a document where every line says where it
came from; Sailo defends its own; and gated content gates through the one
existing predicate.

---

## Non-negotiables

Read first: `docs/specs/README.md` (the ten rules) and
`docs/specs/GAP-2026-08-easytools.md` §4 (the refusals, which stand — no page
builder, no buyer network, no tax service, no per-seller sending domains, no
three-level funnels, no named themes). Then your specs, in full.

`docs/specs/RESHAPE-2026-08.md` is the analysis of why each spec was questioned
and what its smaller version looks like. **The full set is being built** — but
if something in your spec reads as a subsystem rather than a feature, that
document is where the argument for the smaller shape lives. Sailo is *"one template, no checkout to
configure"* and a seller is live in about three minutes — every screen you add
has to earn its place against that.

**The market is the US and the EU, and Stripe is the priority rail.** The chat
and manual rails exist and matter, but a feature that only pays off away from
Stripe is not the priority.

**Wave 0 is done and in the tree:** the chargeback suite runs again (it had been
failing to *load*, reporting "no tests"), spec 44 has landed, and Decisions A
and B are answered and built.

## Environment

```bash
nvm use 22.22.1     # node 20.10 breaks vitest at startup — non-negotiable
```

Scenario suites run against the **Neon dev branch**, not the container `up.sh`
starts. Apply your migration to that branch too:

```bash
npx dotenv -e .env.local.test -- \
  npx vitest run --config vitest.scenarios.mts e2e/scenarios/<yours>.scenario.ts
```

## The loop

**While working:** your package's `npx tsc --noEmit` and the one test file you
touched. Nothing more — a full `turbo test` takes minutes and tells you nothing
extra until you are ready to commit.

**Before a commit,** all of it:

```bash
npx tsc --noEmit && npx vitest run
./e2e/scenarios/up.sh && npx vitest run --config vitest.scenarios.mts
npm run build && npx oxlint
DATABASE_URL=postgres://k:k@localhost/k npx knip
npm run check:i18n
```

Plus **render it and read the visible text** (every RSC payload embeds the error
boundary's copy, so grepping for "something went wrong" matches healthy pages
too), and **verify in a browser** with `.env.local.test` — never `.env.local`,
which is production.

## Strings

Add English keys to `packages/i18n/src/{dictionaries,admin}/en.ts`, then
`npm run i18n:fill` (needs `ANTHROPIC_API_KEY`) or
`npm run i18n:fill -- --from batch.json`.

**Never hand-edit the 34 locale files.** A storefront key missing from any
locale is a compile error. Money sections (checkout, cart, rails, invoice,
billing, membership, download) are never machine-written.

## Rules you will be judged on

- **Claims are conditional UPDATEs** with the ceiling in the WHERE, never a read
  then a write. Webhooks idempotent and ownership-checked. Ledgers append. Order
  *lines*, not headers. Blank ≠ zero.
- **The six recurring bug shapes:** half-updated function pairs, a guard at one
  sink and not its twin, check-then-act, header-vs-lines, blank-vs-zero,
  throttled-as-no.
- **Every public route carries a ceiling.** Decision B is built — pass
  `{ onOutage: "closed" }` on public writes, anything spending money or quota,
  and anything whose answer says whether something exists. Read
  `verdict.reason`: a fail-closed refusal is **not** an answer about the
  request. Worked example: `COUPON_MESSAGES.unavailable` in
  `packages/core/src/money/pricing.ts`.
- **No response may be an existence oracle.** The same sentence whatever it
  found.
- **Plan gating** through `packages/core/src/shop/plans.ts`. No silent caps —
  clamped output says so.
- **Public storefront pages** are `"use cache"` + `cacheTag(shopTag(id))`; any
  write that changes what they show revalidates the tag.
- **Every seller-supplied URL** through the SSRF guard **at the write**, with the
  `lookup` hook rather than resolve-then-fetch.
- **Money-path changes need scenario coverage**, not unit coverage. That is
  where four defects were found last time, by writing them.
- **New columns on `products` are nullable or defaulted**, following
  `apps/web/drizzle/0034_product_kinds.sql`, so an existing catalogue reads and
  sells identically the moment your migration lands.

## Staging

Check `git status` first. **Stage explicit paths. Never `git add -A`.** Other
agents are in this tree and there is unrelated in-flight work in it.
