# Wave C — The five product kinds

You are one of six agents building the Sailo 2026-08 release in
`~/Desktop/Sailo`. You own the **depth of every product kind**: digital,
membership, event, and service. (Physical is Wave B's, and shares the same
discipline.)

This is the wave that decides whether Sailo's five kinds are five real products
or one product with four labels. Each spec is the list of things a seller hits
in month one and finds missing.

Migrations **0043–0046**. Claim each with a one-line commit to
`apps/web/drizzle/` before writing the SQL.

**Order: C3 (event) needs Wave B's sell windows. Do C1 and C2 first, and pick
up C3 when B3 lands. C4 is independent.**

---

## The discipline all four share

`apps/web/drizzle/0034_product_kinds.sql` set it and every one of these follows
it: **every column nullable or defaulted, so an existing catalogue reads and
sells identically the moment your migration lands.** A seller who never opens
the new screen must not notice you shipped.

`packages/db/src/schema/catalog.ts` (`products`) is touched by four waves. Read
the other three prompts' column lists before you add yours.

---

## C1 — Digital depth · L · `0043_digital_depth.sql`

`docs/specs/48-digital-product-depth.md`. Code pools, licence keys with
activations, files per variant, file versions.

**New tables:** `product_codes`, `license_keys`. **Columns on:** `products`,
`product_files`.

> ### The riskiest line in the wave: the code claim
>
> `FOR UPDATE SKIP LOCKED`, claimed **at release, not at checkout**, and
> **never returned to the pool on a refund.**
>
> Each is a separate bug. Claiming at checkout hands a code to an order nobody
> pays for. No `SKIP LOCKED` and two concurrent buyers get the same code.
> Returning on refund hands a stranger a code somebody already redeemed.

§"The claim is the whole security content" and §"The public API — the risky
surface" are the two sections to read twice. **The activation endpoint is public
and unauthenticated** — it carries a ceiling, and under Decision B it fails
closed, because it answers whether a key exists.

**File versions matter more than they look.** A seller who fixes a typo in their
ebook today has buyers holding the old file and no way to tell them. That is a
month-one problem, and §4 is the smallest part of this spec.

---

## C2 — Membership depth · L · `0044_membership_depth.sql`

`docs/specs/49-membership-depth.md`. Fixed terms, cancellation policy, pause,
seats, dunning, upgrade paths.

**New table:** `subscription_seats`. **Columns on:** `products`,
`subscriptions`.

> ### `membershipAccess` gains exactly one branch and no more
>
> Its single-implementation property is why grace periods, the members list, the
> download gate, the door pass and cancellation all behave consistently without
> five copies of the rule drifting apart. **If a second access predicate appears
> in your diff, that is the bug** — Wave F's spec 40 is under an identical
> constraint, so coordinate if you both need one.

**Dunning is the highest-value part and the least glamorous.** `invoice.payment_failed`
is already handled and `sendMembershipPaymentFailed` already exists
(`apps/web/src/lib/stripe-webhooks/memberships/invoices.ts`) — read what it does
before adding to it, and note the comment about not racing Stripe's own dunning
mail. What is missing is the seller's side and the escalation, not the first
email.

Keep the refusal on coupons for memberships; improve the message (§7).

---

## C3 — Event depth · L · `0045_event_depth.sql` *(needs Wave B's sell windows)*

`docs/specs/50-event-product-depth.md`. Tiers, sessions, attendee details,
transfer, `.ics`, venue and timezone, event policy.

**New tables:** `event_tiers`, `event_sessions`. **Columns on:** `products`,
`tickets`, `order_items`.

> **Two-level capacity: tier × product, and session × product. Take the narrower
> one first, in one transaction.** Checking them in two statements, or in the
> wrong order, oversells the tier while the product still looks available.

**What exists:** events are `kind: "event"` with capacity as ordinary stock,
real tickets, check-in, `products.eventJoinUrl` withheld until
`orders.downloadReleasedAt`, and T-24h/T-1h reminders claimed by a row in
`event_reminders` with a unique index on (order, product, lead). **Do not
rebuild the reminder claim** — it is the pattern the rest of this codebase
copies.

Tiers reuse Wave B's sell windows per tier. That is the dependency.

---

## C4 — Service depth · L · `0046_service_depth.sql`

`docs/specs/51-service-and-physical-depth.md` — **the service half only** (§
"Service — five gaps"). Wave B owns the physical half; agree the migration
between you if you both need `products` columns.

Staff calendars, group bookings and classes, buyer reschedule and cancel, intake
forms, reminders. **New tables:** `staff_resources`, `product_staff`,
`booking_claims`.

> ### The exclusion constraint moves from `(shop, range)` to `(staff, range)`
>
> **That constraint is the guarantee Sailo never double-books.** It lives in
> `apps/web/drizzle/0004_booking_overlap.sql` — one of five grandfathered files
> with an unguarded `ADD CONSTRAINT`, so re-running it is not safe.
>
> Change it, then **run the concurrency scenarios first and read the count.** A
> suite that no longer exercises the constraint passes for the wrong reason, and
> that is exactly what this instruction exists to catch.

**Buyer reschedule and cancel (§3) is the month-one gap.** Today a buyer must
message the seller to move an appointment. The link pattern already exists twice
in the tree — `packages/commerce/src/disputes/arrival.ts` and
`packages/marketing/src/broadcasts/unsubscribe.ts` — signed with a key derived
from `BETTER_AUTH_SECRET`, no row written at send time, works from a cold mail
client months later. **Copy that, do not invent a third.**

`availability.ts` already has `excludeOrderId` for exactly this — read it first.

Intake forms reuse Wave D's checkout custom fields. **Do not build a second
field model.**

---

## Done when

All four kinds configure and sell; every existing product is unaffected; the
code claim and the exclusion constraint each have concurrency scenarios that
demonstrably fail without the guard; and `membershipAccess` still has one
implementation.

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
