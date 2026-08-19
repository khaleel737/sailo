# Release handoff — one card per spec, for parallel agents

Companion to `RELEASE-PLAN-2026-08.md`, which holds the order and the argument.
This holds the **assignment**: what each agent is given, which files it owns,
which migration number it may claim, and what it must not break. Written
2026-08-19, after Wave 0 and spec 44 landed.

Read first, in this order, and do not skip them:

1. `README.md` in this folder — the ten rules. Rule 1 (a schema change is not
   shipped until its migration has run against production) and rule 4 (stage
   explicit paths; concurrent agents work in this tree) are the two that have
   already cost this repo an outage and someone else's commit.
2. `GAP-2026-08-easytools.md` §4 — the refusals. Scope creep into a page
   builder, a buyer network, a tax service or per-seller sending domains is the
   failure mode this whole release is written against.
3. Your own spec, in full, before writing a line.

---

## The state of the tree as this was written

**Done and merged into the working tree** (not yet committed — see *Coordination*):

| | |
|---|---|
| Wave 0 §0.1 | Disputes suite repaired. `0 → 36` tests in `disputes.scenario.ts`, `0 → 25` in `dispute-files.scenario.ts`, and 14 new in `apps/hq/e2e/scenarios/dispute-desk.scenario.ts`. The whole 1,583-line chargeback suite had been failing to *load* and reporting "no tests" |
| Wave 0 §0.2 | The confirmation-receipt race fixed (`confirmationSentAt` was a check-then-act, not a claim) and the same shape fixed on the seller notice and the `order.created`/`order.paid` emissions. Two new scenarios in `settlement.scenario.ts` |
| Wave 0 §0.3 | knip clean |
| Wave 0 §0.5 | **Decision A answered: machine-translate on merge.** Pipeline built — see *The i18n contract* below |
| Wave 0 §0.6 | **Decision B answered.** `rateLimit` takes `{ onOutage: "closed" }`; 18 call sites converted, four deliberately left open with reasons beside them |
| Spec 44 | Built. `drizzle/0035_evidence_capture.sql` applied to the **dev branch only** |

**Not done:** every other spec below. Waves 1–5 are unstarted.

---

## Coordination — read before you touch anything

### Migration numbers are pre-assigned here

The last file in `apps/web/drizzle/` is `0035_evidence_capture.sql`. Ten specs
add a migration, and two agents both writing `0036_` is a merge conflict in the
one place a merge conflict is expensive.

**Your number is in your card below. Claim it with a one-line commit to
`apps/web/drizzle/` before you write the SQL.** If you collide anyway, the later
one renumbers — the migration that has already run against production wins,
always.

| # | Spec | File |
|---|---|---|
| 0036 | 34 | `0036_audience.sql` |
| 0037 | 30 | `0037_automations.sql` |
| 0038 | 32 | `0038_checkout_sessions.sql` |
| 0039 | 08 | `0039_order_bumps.sql` |
| 0040 | 36 | `0040_cross_sells.sql` |
| 0041 | 43 | `0041_pricing_models.sql` |
| 0042 | 46 | `0042_platform_evidence.sql` |
| 0043 | 48 | `0043_digital_depth.sql` |
| 0044 | 49 | `0044_membership_depth.sql` |
| 0045 | 50 | `0045_event_depth.sql` |
| 0046 | 51 | `0046_service_physical_depth.sql` |
| 0047 | 07 | `0047_lead_capture.sql` |
| 0048 | 33 | `0048_waitlists.sql` |
| 0049 | 35 | `0049_testimonials.sql` |
| 0050 | 41 | `0050_shop_pages.sql` |
| 0051 | 52 | `0051_data_requests.sql` |
| 0052 | 47 | `0052_imports.sql` |
| 0053 | 37 | `0053_shop_team.sql` |
| 0054 | 38 | `0054_tax_jurisdictions.sql` |
| 0055 | 39 | `0055_custom_domains.sql` |
| 0056 | 40 | `0056_content_collections.sql` |
| 0057 | 31 | `0057_integration_scenarios.sql` |

Specs **42**, **45** and **44** need no migration (44's has landed).

`apps/web/drizzle/README.md` is the contract for the SQL itself: hand-written,
`IF NOT EXISTS` throughout, and every `ADD CONSTRAINT` wrapped in the
`DO $$ … EXCEPTION WHEN duplicate_object` form. `apps/web/src/lib/migrations.test.ts`
enforces all of it — run it before you think you are done.

### Staging

**Never `git add -A`.** Several agents work in this tree at once. Check
`git status`, stage the paths you own, leave everything else. There is already
an unrelated in-flight change set (product kinds, `0034`) that is not yours.

### Files more than one spec touches

These are the collision points. If your card names one, read what the other
spec does to it before you start.

| File | Specs |
|---|---|
| `packages/commerce/src/orders/resolve-lines.ts` | 08, 36, 43 |
| `apps/web/src/lib/actions/order-preview.ts` | 08, 36, 43 |
| `apps/web/src/lib/actions/orders.ts` (`createOrderIntent`) | 08, 36, 43, 51 |
| `packages/db/src/schema/catalog.ts` (`products`) | 07, 08, 43, 48, 49, 50, 51 |
| `packages/marketing/src/broadcasts/segment-sql.ts` | 30, 34 |
| `packages/marketing/src/broadcasts/render.ts` | 30, 36 |
| `apps/web/src/lib/session.ts` (`requireShop`) | **37 rewrites it; everything else calls it** |
| `packages/i18n/src/dictionaries/*.ts` | every spec with buyer-facing copy |
| `packages/i18n/src/admin/*.ts` | every spec with a seller-facing screen |

**Spec 37 is the one to sequence around.** It gives `requireShop()` a required
permission argument and audits every call site. Land it when the tree is
quietest, or land it last.

### The i18n contract (Decision A, as built)

- `npm run check:i18n` — the report. **Exits non-zero on a storefront hole**,
  because `dictionaries/*.ts` are typed as the complete `Dictionary` and a
  missing key is a compile error. Admin holes fall back to English at runtime
  and are reported, not enforced.
- `npm run i18n:fill` — fills gaps from `en.ts` using Claude. Needs
  `ANTHROPIC_API_KEY`. `--dry-run` works without one.
- `npm run i18n:fill -- --from batch.json` — splices translations from a file,
  no model involved. Shape:
  `{ "storefront": { "de": { "section.key": "text" } } }`.

Three guards you cannot switch off, all in `packages/i18n/src/tooling/`:

- **Protected money sections are never machine-written.** `glossary.ts` lists
  them — checkout, cart, rails, invoice, billing, membership, download on the
  storefront; billing, payments, payouts, coupons, orders and their statuses in
  the admin. If your spec adds a string to one of those, it needs a human.
- **An existing translation is never overwritten**, so a correction survives.
- **A changed `{placeholder}` is refused.** A renamed one typechecks, splices,
  renders, and shows a customer the literal text `{count}`.

**So: add your English keys to `en.ts`, then fill.** Do not hand-edit 34 files —
the splicer exists so that nobody has to, and hand-editing is how a dictionary
gets corrupted. There is a worked example in the tree: the 8 `arrival.*` keys of
spec 44, spliced into all 34 locales as 13-line diffs.

Standing debt, unrelated to you: the admin is **14,212 strings short** across 34
locales — about a third of it falls back to English today. That predates this
release.

### The verification gate

`README.md` rule 2, in this order, **before a commit** — not after every edit:

```bash
nvm use 22.22.1                                   # node 20.10 breaks vitest at startup
npx tsc --noEmit
npx vitest run                                    # in your package
./e2e/scenarios/up.sh && npx vitest run --config vitest.scenarios.mts
npm run build
npx oxlint
DATABASE_URL=postgres://k:k@localhost/k npx knip
npm run check:i18n
```

While working, run only what you changed: your package's `tsc --noEmit` and the
one test file. The full turbo run takes minutes and tells you nothing extra
until you are ready to commit.

**Scenario suites run against the Neon dev branch**, not the container:
`npx dotenv -e .env.local.test -- npx vitest run --config vitest.scenarios.mts <file>`.
`up.sh` starts a container the suites ignore. Apply your migration to that
branch too, or your scenarios fail for the wrong reason.

Plus, per spec, the two a green suite does not cover:

- **Render it and read the visible text.** Every RSC payload embeds the error
  boundary's copy, so grepping a page for "something went wrong" matches the
  healthy ones. `curl | grep` is not a health check.
- **Verify in a browser.** Typecheck misses `use server` export rules, swallowed
  queries answering 200, and DOM bugs. Use `.env.local.test`, never
  `.env.local`, which is production.

---

# Wave 1 — the engine. Sequential: 34, then 30.

## Spec 34 — Contacts, lists, custom fields, unsubscribes

**P0 · L · migration `0036_audience.sql` · blocks 30**

Unifies two half-audiences (`clients` from orders, `subscribers` from the signup
form) into one contact model with lists and custom fields. Its eight rules are
the correctness floor for everything in this release that sends mail.

**New tables:** `contact_lists`, `contact_list_members`, `contact_fields`,
`contact_field_values`.

**Owns:**
- `packages/db/src/schema/audience.ts` — the four tables
- `packages/marketing/src/audience/` — new: list membership, field values
- `packages/marketing/src/broadcasts/segment-sql.ts` — **shared with 30**
- `packages/marketing/src/broadcasts/segments.ts`
- `apps/web/src/app/admin/audience/` — the screens
- `apps/web/src/lib/actions/` — the audience actions
- Checkout custom fields: `apps/web/src/app/[handle]/_components/cart/checkout-panel.tsx`

**Do not break:** the existing broadcast audience queries. Consent-only
audiences, RFC 8058 one-click unsubscribe and bounce suppression already ship
and are a legal floor, not a feature — `packages/marketing/src/broadcasts/`.

**Scenario coverage required:** list membership is idempotent; a contact
unsubscribed from one list is not unsubscribed from all; a custom field value
survives the contact being merged from two sources.

---

## Spec 30 — Email automations (flows)

**P0 · XL · migration `0037_automations.sql` · depends on 34 · blocks 31, and is a
trigger sink for 32, 33, 35, 40**

The headline gap. `README.md` says "*Not built: flows*" three times.

**New tables:** `automations`, `automation_steps`, `automation_runs`,
`automation_emails`.

**Owns:**
- `packages/marketing/src/automations/graph.ts` — the step graph
- `packages/workflows/src/automations/tick.ts` — the runner
- `apps/web/src/app/admin/marketing/automations/` — the screens
- Triggers (v1, four) and steps (v1, four) — §"Triggers" and §"Steps" in the spec

**Reuses, does not reinvent:** `packages/marketing/src/broadcasts/markdown.ts`,
`render.ts`, `segment-sql.ts`, and `packages/workflows/src/webhooks/attempt.ts`. §"Build on what exists" in
the spec lists them; the runner is new, the rendering and sending are not.

> ### The one thing that must not happen in wave 1
>
> **Spec 30 must not touch `packages/marketing/src/lifecycle/steps.ts`, and the
> HQ Journeys screen must keep reading it.** The argument is in
> `GAP-2026-08-easytools.md` §3.2 and in the header comment of
> `apps/hq/src/app/(panel)/marketing/journeys/page.tsx`. A pull request that
> migrates the twelve rungs into `automations` should be refused.

**Do not break:** the daily send ceilings. Three of them exist and they are
separate on purpose — a campaign must never eat the budget that carries a
buyer's receipt. See the `BROADCAST_DAILY_CEILING` note in `README.md`.

**Decision B applies:** the send path spends quota, so its ceiling
**fails closed**. `rateLimit(key, n, w, { onOutage: "closed" })`.

---

# Wave 2 — revenue. Fully parallel.

## Spec 32 — Checkout recovery and checkout sessions

**P1 · L · migration `0038_checkout_sessions.sql` · no dependencies**

Highest revenue per line in the release. **Take the mechanism; refuse the
commission and the shared buyer network** — `GAP-2026-08-easytools.md` §4.

**New table:** `checkout_sessions`.

**Owns:** the session-create write on checkout view, the recovery email, the
resume link, and the tiles 42 later reads.

**Decision B applies, and this is the case it was decided for:** session-create
is a **public write on every checkout view**. It **fails closed**.

**Consent is the part to get right** — §"Consent" in the spec. An abandoned
checkout is not a marketing opt-in.

**Money-path spec: scenario coverage, not unit coverage.**

---

## Spec 08 — Order bumps

**P2 · M · migration `0039_order_bumps.sql`**

> **Read spec 36 first.** It supersedes 08's `products.bumpProductId` with an
> `offers` table and keeps its `viaBump` attribution. If 36 is being built in
> parallel, agree who lands the table.

**Columns:** `products.bumpProductId`, `products.bumpHeadline`.

**Owns:** the bump tile in the checkout panel, and the attribution on the order.

---

## Spec 36 — Cross-sells, upsell tiles, thank-you page

**P1 · L · migration `0040_cross_sells.sql` · depends on 08's vocabulary**

**New tables:** `offers`, `offer_events`.

Post-payment, flat, `parent_id` present and always null in v1.

**Owns:** the thank-you page, the offer surfaces, `broadcasts/render.ts`
(shared with 30).

---

## Spec 43 — PWYW, donation preset, sell windows, manual trials

**P1 · M · migration `0041_pricing_models.sql` · blocks 33**

**Columns:** `products.pricing_mode`, `min_price_cents`,
`suggested_price_cents`, `sell_from`, `sell_until`, `hide_when_unavailable`,
and the matching `product_variants` columns.

> **The only place in the checkout where a price comes from the request.**
> Clamp at **both** sinks — `resolveLines` *and* `previewOrder` — and remember
> `createOrderIntent` is the third. `PRODUCTION-PLAN.md`'s recurring bug shape is
> *"guard applied at one sink not its twin"*.

Also touches `packages/core/src/wire/resources.ts`.

---

## Spec 45 — Order evidence pack (PDF)

**P1 · L · no migration · depends on 44 (built)**

Turns seven of nine `needs_seller` evidence slots into `held`. **Renders on
demand from 44's immutable snapshot — do not store a PDF per order.**

**Owns:** `packages/core/src/disputes/pack.ts` (new), and it reuses
`apps/web/src/lib/invoice-pdf.ts`, `packages/core/src/disputes/assemble.ts`,
`packages/core/src/disputes/files.ts`, `packages/commerce/src/disputes/files.ts`
and `packages/commerce/src/disputes/holdings.ts`.

**Everything 44 captured is now available to you:** `policy_snapshots`,
`order_messages`, `orders.delivered_at` / `delivered_source` /
`delivery_signed_by`, `orders.statement_descriptor`, `account_events`. The
readers are exported from `@sailo/commerce/disputes` — `messagesForOrder`,
`latestSnapshot`, `accountHistory`.

> ### The rule 45 and 46 share, and it is absolute
>
> **Never state a fact Sailo does not hold.** A pack claiming "delivered"
> because a seller ticked a box, or printing today's refund policy against a
> sale from March, is a false claim to a bank made on the seller's behalf. Every
> line carries its provenance and its date. `orders.delivered_source` exists
> precisely so the pack can say *who* said it arrived — `seller`,
> `buyer_confirmed` and `carrier` are not equally persuasive and must not be
> printed as though they were.

---

## Spec 46 — Platform subscription disputes

**P1 · M · migration `0042_platform_evidence.sql` · depends on 44 (built)**

Sailo stops losing its own chargebacks uncontested.

**New table:** `platform_usage_daily`.

**44 already gave you:** `account_events` (a sign-in history that outlives a
better-auth session — the thing this spec could not have been built on before),
and Sailo's own policy snapshots (`policy_snapshots` with `shop_id IS NULL`,
written by `snapshotPlatformPolicies()` in
`packages/commerce/src/disputes/policies.ts`).

**Wire `snapshotPlatformPolicies()` into a deploy step.** It is written, tested
and currently called by nothing.

> **Includes the rule that matters most: when the seller is right, refund
> rather than contest.**

---

# Wave 2b — product depth. Fully parallel, one migration each.

All four follow the `0034_product_kinds.sql` discipline: **every column nullable
or defaulted, so an existing catalogue reads and sells identically the moment it
lands.**

## Spec 48 — Digital depth

**P1 · L · migration `0043_digital_depth.sql`**

**New tables:** `product_codes`, `license_keys`. **Columns on:** `products`,
`product_files`.

> **The riskiest line: the code claim.** `FOR UPDATE SKIP LOCKED`, claimed **at
> release, not at checkout**, and **never returned to the pool on refund**.

§"The claim is the whole security content" and §"The public API — the risky
surface" are the two sections to read twice.

---

## Spec 49 — Membership depth

**P1 · L · migration `0044_membership_depth.sql` · depends on 36's `offers`**

**New table:** `subscription_seats`. **Columns on:** `products`, `subscriptions`.

> **`membershipAccess` gains exactly one branch and no more.** Its
> single-implementation property is why grace, the members list, the download
> gate, the door pass and cancellation all work without a second copy. A second
> access predicate in the diff is the bug.

---

## Spec 50 — Event depth

**P1 · L · migration `0045_event_depth.sql` · depends on 43's sell windows**

**New tables:** `event_tiers`, `event_sessions`. **Columns on:** `products`,
`tickets`, `order_items`.

> **Two-level capacity — tier × product, session × product. Narrower first, one
> transaction.**

---

## Spec 51 — Service and physical depth

**P2 · L · migration `0046_service_physical_depth.sql` · depends on 34's custom
fields**

**New tables:** `staff_resources`, `product_staff`, `booking_claims`,
`shipments`. **Columns on:** `products`, `delivery_methods`, `order_items`.

> **The exclusion constraint moves from `(shop, range)` to `(staff, range)`.**
> That is the guarantee Sailo never double-books. Change it, then run the
> concurrency scenarios **first**, and read the count — a suite that no longer
> exercises the constraint passes for the wrong reason. The constraint lives in
> `apps/web/drizzle/0004_booking_overlap.sql`; note it is one of the five
> grandfathered files with an unguarded `ADD CONSTRAINT`.

---

# Wave 3 — reach. Fully parallel. Each is a trigger source for spec 30.

## Spec 07 — Lead capture

**P1 · M · migration `0047_lead_capture.sql` · depends on 05 (built), 04 (built)**

Already written; `README.md` calls it "Next up" and the consent column it waited
for exists.

**New table:** `leads`. **Columns:** `products.kind = "lead"`,
`products.leadQuestions jsonb`, `clients.source text`.

> **Price is forced to 0 in the action, not the form.** `priceCents` stays `0`,
> never null — blank ≠ zero (rule 6).

**Money-path note:** the zero-value path needs **scenario** coverage.

---

## Spec 33 — Waitlists

**P2 · M · migration `0048_waitlists.sql` · depends on 43**

**New table:** `waitlist_entries`.

Ships the notification Easytools admits they do not.
**Decision B: the join is a public write — fails closed.**

---

## Spec 35 — Testimonials / wall of love

**P2 · M · migration `0049_testimonials.sql`**

**New tables:** `testimonials`, `testimonial_walls`, `testimonial_requests`.

> **The embed is the risky part:** its own CSP, `frame-ancestors *`, and a
> cross-origin iframe E2E. Do not widen the storefront's CSP to make the embed
> work.

**Decision B: submission is a public write — fails closed.** There is a
precedent to copy exactly: `apps/web/src/lib/actions/reviews.ts`.

---

## Spec 41 — Seller legal pages

**P2 · S · migration `0050_shop_pages.sql`**

**New table:** `shop_pages`.

Small, and it is what makes `requireTerms` usable. English-only document,
translated chrome.

> **This closes a loop 44 left open.** `policySnapshotsForOrder` currently
> resolves snapshots that already exist and never fetches. Once `shop_pages`
> exists, snapshot `body_md` **directly** with `source: "shop_page"` — the good
> path, because the text is ours and cannot change under us. See
> `packages/commerce/src/disputes/policies.ts`, which already documents the
> three sources and their relative trustworthiness.

---

## Spec 52 — Buyer data requests

**P2 · M · migration `0051_data_requests.sql`**

**New table:** `data_requests`.

> **Statutory 30-day clock. Verification before assembly, always. The
> suppression list is never erased** — erasing it re-subscribes somebody who
> asked to be left alone.

---

## Spec 47 — Migrate from other tools

**P1 · L · migration `0052_imports.sql`**

**New tables:** `import_jobs`, `import_links`.

Stripe and CSV ungated; **Shopify** is the one migrant our competitors cannot
serve.

> **Imports no orders and no consent.** An imported contact has not opted in to
> anything, and treating an import as consent is the single fastest way to
> damage the sending domain every other seller shares.

---

# Wave 4 — business. Fully parallel.

## Spec 37 — Team members and roles

**P1 · M · migration `0053_shop_team.sql`**

**New tables:** `shop_roles`, `shop_members`, `shop_member_actions`.

> ### The riskiest change in the whole plan
>
> `requireShop()` gains a **required** permission argument and every call site is
> audited. **Count them and write the number down**, as `PRODUCTION-PLAN.md` did
> for 32 actions and 20 HQ queries. A call site that compiles because the
> argument was defaulted is a hole that shipped.
>
> There is a precedent in the tree for what "enforced" means: every HQ write
> names a `StaffCapability`, and a bare `requireStaff()` was the hole that
> shipped once.

**Decision B: the invite endpoint is an account oracle — fails closed.**

**Sequence this when the tree is quiet.** It touches nearly every action.

---

## Spec 38 — Tax jurisdictions, thresholds, country control, report

**P2 · L · migration `0054_tax_jurisdictions.sql`**

**New tables:** `tax_jurisdictions`, `tax_country_rules`, `tax_revenue_daily`.

> **Sum stored minor units. Never re-derive tax from a rate.** The order carries
> what was charged; recomputing it from today's rate answers a different
> question and disagrees with the invoice.

**Money-path spec: scenario coverage.** And: **nothing here presents itself as
tax advice.**

---

## Spec 39 — Custom domain — **REFUSED, DO NOT BUILD**

**Refused 2026-08-19**, in the owner's words: *"Remove custom domains, we will
never add it, it will always be sailo.store/store-name."*

A shop's address is `sailo.store/<handle>` and always will be. No `shop_domains`
table, no hostname column on `shops`, no host-based routing, no per-domain
canonical, sitemap or CSP, no DNS verification, no platform domains API.

A build was started against this brief on 2026-08-19 and backed out the same
day. The argument is `GAP-2026-08-easytools.md` §4.11 and the spec is
`deferred/39-custom-domain.md`.

---

## Spec 42 — Analytics expansion

**P2 · M · no migration · depends on 30, 32, 07**

Pixels, four metric tiles, share links, checkout link vocabulary.

**Sequenced last in its wave so no tile ships always-zero.** If 30 and 32 are
not merged, your tiles have nothing to count.

---

# Wave 5 — content. Largest, least urgent, most likely to be reshaped.

## Spec 31 — Integration scenarios

**P3 · L · migration `0057_integration_scenarios.sql` · depends on 30**

**New table:** `integration_apps`.

Shares 30's runner and its `automations` table. Actions are generic; **the
app-directory refusal stands** (`GAP-2026-08-easytools.md` §4).

---

## Spec 40 — Gated content collections

**P3 · L · migration `0056_content_collections.sql`**

**New tables:** `collections`, `collection_items`, `content_progress`.

Supersedes `deferred/18-ecourse.md`.

> **Writes no new access predicate.** If one appears in the diff it is wrong —
> `membershipAccess` is the single implementation, and spec 49 is under the same
> constraint for the same reason.

**Decision B: the progress write is a public write — fails closed.**

---

# What "production ready" means at the end

From `RELEASE-PLAN-2026-08.md`, unchanged, with what is already true marked:

1. ✅ `tsc` → 0, `oxlint` → 0 errors, `knip` → clean, build exit 0. *(true now;
   keep it true)*
2. ⚠️ The scenario suite covers the **card** path end to end through a forwarded
   webhook. *(the assertions exist and pass against constructed events; the
   live `stripe listen` loop is documented in `e2e/scenarios/card-e2e.md` and
   has been run once by hand)*
3. ✅ Every public route carries a ceiling, and Decision B is recorded beside
   each one.
4. ⬜ Every seller-facing write names a permission (**spec 37**) and every HQ
   write names a `StaffCapability` *(the HQ half is already true)*.
5. ✅ `check:i18n` green under Decision A, with the debt listed rather than
   silent.
6. ⬜ Every new public write probed for being an existence oracle, answering the
   same sentence whatever it found. *(the pattern to copy is
   `COUPON_MESSAGES.unavailable` in `packages/core/src/money/pricing.ts` and the
   `reason` field on `RateVerdict`)*
7. ⬜ Every seller-supplied URL through the SSRF guard **at the write**, with the
   `lookup` hook rather than resolve-then-fetch. Six writes had to be fixed
   once; this release adds at least four more (35 embed, 39 domain, 41 pages,
   47 import).
8. ⬜ No feature presents itself as tax or legal advice.
8b. ⬜ Every line in a generated evidence document names where it came from and
   when it was recorded, and no document asserts a fact the database does not
   hold.
9. ⬜ The refusals in `GAP-2026-08-easytools.md` §4 are still refused.

---

## Two things still owed by whoever owns the release

- **`apps/web/drizzle/0035_evidence_capture.sql` has not been applied to
  production.** It is applied to the dev branch and verified idempotent. Rule 1
  says schema ships to prod first; this one has not.
- **Nothing described above is committed.** It is all in the working tree,
  alongside an unrelated in-flight change set.
