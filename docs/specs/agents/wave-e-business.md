# Wave E — Business

You are one of six agents building the Sailo 2026-08 release in
`~/Desktop/Sailo`. You own **four** items: who else can work in the shop, what
the seller owes in tax, and two ways of turning a visitor into a contact.

Migrations **0052–0055**. Claim each with a one-line commit to
`apps/web/drizzle/` before writing the SQL.

**Order: E2, E3, E4 first. E1 lands LAST and alone** — see below.

---

## E1 — Team members and roles · M · `0052_shop_team.sql`

`docs/specs/37-seller-team-roles.md` — **rewritten 2026-08-19 to build on Better
Auth's organization plugin. Read the new version, not your memory of the old
one.**

Sailo already runs Better Auth with three plugins, and
`better-auth/plugins/organization` is installed. It provides `organization`,
`member`, `invitation`, `team`, `teamMember`, plus `createAccessControl` and
`hasPermission`.

**So you do not write:** roles, members, invitation tokens, expiry, acceptance,
revocation, or a permission evaluator. That is the plugin's, tested upstream,
and it is the half most easily got subtly wrong by hand — an invite token with
no expiry, a revoked member whose session outlives the revocation.

**What is yours** is four things, and the third is the whole risk:

1. The permission statements, in Sailo's vocabulary. The spec proposes seven
   resources; `refund` and `export` are separate actions on purpose, because
   they are the two a seller most often withholds.
2. `shops.organizationId`, with **every existing shop backfilled in the
   migration** so no shop is ever left with nobody able to administer it.
   `shops.userId` stays the owner of record — spec 03, the closure record and
   every existing ownership check read it.
3. **`requireShop()` gains a required permission argument, and every call site
   is audited.**
4. The settings screen.

> ### Make the argument required. Do not default it.
>
> A call site that still compiles because the parameter was optional is a hole
> that shipped, and it compiles silently across a hundred files. Required, and
> the compiler enumerates the work for you.
>
> **Count the call sites and write the number down.** `PRODUCTION-PLAN.md` did
> exactly that for 32 actions and 20 HQ queries, and that number is what lets
> the next person verify the audit was complete rather than plausible.
>
> There is a precedent for what *enforced* means: every HQ write names a
> `StaffCapability`, and a bare `requireStaff()` was the hole that shipped once.

**Land this last and alone.** Five other agents are editing actions that call
`requireShop()`; landing it mid-flight turns every one of their branches into a
conflict in files they never opened.

**Decision B:** the invite endpoint is an account oracle — fails closed, and
answers the same sentence whether or not that address has a Sailo account.
**Revocation must end the session, not just the row** — verify the plugin's
session handling, do not assume it.

---

## E2 — Tax jurisdictions, thresholds, country control, report · L · `0053_tax.sql`

`docs/specs/38-tax-jurisdictions-thresholds.md`. **New tables:**
`tax_jurisdictions`, `tax_country_rules`, `tax_revenue_daily`.

> **Sum stored minor units. Never re-derive tax from a rate.** The order carries
> what was actually charged; recomputing from today's rate answers a different
> question and will disagree with the invoice the buyer holds and the return the
> seller files. `orders.taxCents` is a snapshot for exactly this reason — read
> its comment.

**This is a US and EU spec, and those are two different problems.** EU VAT has a
distance-selling threshold and OSS; US sales tax has per-state economic nexus.
A seller crossing either without noticing is the failure this reports on, and it
is the most likely way a Sailo seller gets an unpleasant letter.

Stripe Tax already runs on the **seller's own** connected account, with their
registrations and their liability; Sailo is never merchant of record on a Sailo
sale. This reports on that, it does not replace it — §4.3 refused becoming a tax
provider and that refusal stands.

> **Nothing here presents itself as tax advice.** A threshold tile reading "you
> must register in Germany" is a legal claim Sailo is not qualified to make.
> State what was collected and where; let the seller draw the conclusion.

**Money path: scenario coverage.**

---

## E3 — Lead capture · M · `0054_lead_capture.sql`

`docs/specs/07-lead-capture.md`. Already written; `README.md` calls it "Next up"
and the consent column it waited for (spec 05) exists.

**New table:** `leads`. `products.kind = "lead"`, `products.leadQuestions jsonb`,
`clients.source text` defaulting `purchase` on existing rows.

> **Price is forced to 0 in the action, not the form.** `priceCents` stays `0`,
> never null — blank ≠ zero, rule 6. A form-level default is a claim the client
> makes, and the whole point is that it is not one.

**The zero-value path needs scenario coverage.** A £0 order settling through the
wrong branch is a real failure mode — see how spec 44's settlement scenarios
treat `no_payment_required`.

Worth noting while you build it: the same mechanism — **a zero-priced product
that asks questions** — is a sample request, a quote request and a made-to-order
enquiry. Naming it well in the admin serves the physical seller too.

---

## E4 — Testimonials / wall of love · M · `0055_testimonials.sql`

`docs/specs/35-testimonials-wall-of-love.md`. **New tables:** `testimonials`,
`testimonial_walls`, `testimonial_requests`.

**Sailo already has `reviews`** (`packages/db/src/schema/catalog.ts:380`), and
`README.md` names them as part of what the incumbents lack. Before adding three
tables, be sure what you are building is not a second review system — if the
wall can read `reviews`, it should.

> **The embed is the risky part:** its own CSP with `frame-ancestors *`, and a
> cross-origin iframe E2E to prove it. **Do not widen the storefront's CSP to
> make the embed work** — that policy is scoped deliberately (spec 09's pixels
> live inside it) and loosening it takes every shop's protection with it.

**Decision B:** submission is a public write and **fails closed**. There is a
precedent to copy almost exactly — `apps/web/src/lib/actions/reviews.ts`.

---

## Done when

A seller can invite somebody and choose what they can do; every seller-facing
write names a permission and the call-site count is written down; tax sums
stored minor units and claims nothing legal; a zero-priced product collects
answers; and the wall renders without loosening anybody's CSP.

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
