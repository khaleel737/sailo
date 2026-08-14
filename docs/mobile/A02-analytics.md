# A02 — Analytics package & shop procedures

**Wave:** 1 · **Effort:** M (1 week) · **Depends on:** A00 · **Blocks:** A09, A06

## Mission

Lift the analytics read layer out of `apps/web` into a package both apps can
use, and expose the procedures the Insights tab and the onboarding checklist
read through.

## Owns — exclusive write access

- `packages/analytics/**` (new)
- `packages/api/src/routers/analytics.ts`
- `packages/api/src/routers/shop.ts`
- `apps/web/src/lib/queries/analytics.ts`, `analytics-window.ts` (move out)
- `apps/web/src/lib/actions/shop.ts` (extract only)
- `apps/web/src/replica.test.ts` (the reporting allowlist only — see below)
- `apps/web/src/lib/plans.ts` → `packages/core/src/plans.ts` (move out — see below)
- `apps/web/src/lib/handle.ts` → `packages/core/src/handle.ts` (move out)

## Lifting handle.ts

`shop.checkHandle` and `shop.create` need the handle rules. Lift
`apps/web/src/lib/handle.ts` to `packages/core/src/handle.ts` — its own header
already says it is pure, with no database and no `"use server"`, and it carries
a 216-line test that moves with it. Four importers, one of which is that test
and one of which is `actions/shop.ts` you already own. Web keeps working
through a re-export shim; add `"./handle"` to core's `exports` map.

Do this rather than restating the regex in `packages/api`. `RESERVED_HANDLES`
is the part that would drift silently — a name reserved on web but not on
mobile is a seller claiming a handle that collides with a route.

## shop.setup waits for A04, deliberately

`shop.setup` needs `enabledRailCount`, which comes from `getCheckoutMethods` —
A04 owns moving it into a package. **Do not ship a partial version wired only
to `stripeChargesEnabled`.**

`packages/core/src/onboarding.ts` spells out why in its `SetupSignals` comment:
cash on delivery, a bank transfer and a WhatsApp handoff all count, and a
seller in a market where nobody takes cards is fully set up without Stripe.
A `paid` step that counts only Stripe tells those sellers their shop is broken
when it is working — a worse outcome than the step arriving a few days later.

A04 is Wave 1 and running in parallel. Tell them `getCheckoutMethods` is
blocking a procedure, then land `shop.setup` as a final commit once it moves.
Ship the other three now — A06 is waiting on `checkHandle` and `create`.

## Lifting plans.ts

Server-side plan clamping needs `planFor`/`analyticsLimit`, which live in
`apps/web/src/lib/plans.ts` and are unreachable from `packages/api`. **Move the
whole file to `packages/core/src/plans.ts`.** Do not duplicate the allowance in
`@sailo/analytics` — plan gating is checked server-side and never trusted from
the UI, and a second copy that drifts hands a mobile client a window its plan
does not permit, silently.

The move is smaller than the ~50 importers suggest:

- `plans.ts` already imports `taxOn` from `@sailo/core/pricing`, so moving it
  into core **removes** a dependency edge rather than adding one.
- `packages/core` already depends on `@sailo/db`; the `Shop` type travels
  unchanged.
- `Dictionary` is a type-only import (`keyof Dictionary["highlights"]`) and
  `@sailo/i18n` has no dependencies of its own — add it to core, no cycle.
- **`BillingShape` already exists** (`Pick<Shop, "plan" | "subscriptionStatus">
  & { compPlan }`). `planFor` and `analyticsLimit` already take that narrow
  structural type, so `packages/api` can call them with any object carrying
  those three fields. **Change no signature.**
- Web keeps working through a one-line re-export:
  `apps/web/src/lib/plans.ts` → `export * from "@sailo/core/plans"`. No
  importer changes.

Two things to remember: add `"./plans": "./src/plans.ts"` to core's `exports`
map — it is explicit, not a wildcard. And keep
`resolveAnalyticsWindow(shop, params)` taking the shop and calling
`analyticsLimit` itself, exactly as it does on web today; passing a
pre-computed allowance in gives every future caller somewhere to forget the
clamp.

If `apps/api` fails to build with an import error that reads like a bug in a
package, add `@sailo/core` to `transpilePackages` in `apps/api/next.config.ts`
— that list is a deliberate transitive closure, not a superset.

## The replica boundary comes with you

Moving `queries/analytics.ts` breaks `apps/web/src/replica.test.ts`. Its
"keeps the replica to reporting" case greps `src` for `getReadDb` and asserts
**exact equality** against an allowlist that names your file.

**Do not resolve this by injecting a db handle and leaving a wrapper behind in
`src`.** That moves the replica-vs-primary decision from the query — where it
is a property of the work, analytics being reporting — to the caller, where it
is a guess. `packages/api` would then have to choose one when it serves the
mobile Insights tab, and choosing wrong is silent: the query runs and the rows
come back. It also walks the code out of grep-based governance while leaving a
green test that measures nothing. This suite's header is explicit that its
rules are structural and read the source.

Resolve it the way the file already resolves this exact situation twice:

1. **Remove** `"src/lib/queries/analytics.ts"` from the `allowed` set. Its
   sibling comment records `src/db/index.ts` being dropped for the same reason
   — the file left the app's source tree.
2. **Extend** the case to also grep `../../packages/analytics/src`, and
   allowlist the moved file there. `PRIMARY_ONLY` already pins across the
   package boundary this way (`"../../packages/commerce/src/inventory.ts"`),
   with a comment explaining that leaving the tree did not change what the code
   is. Follow that pattern and comment yours the same way.
3. `@sailo/analytics` keeps calling `getReadDb()` itself. Reporting is
   reporting whichever app asks.

Tell A15: `apps/api` should get `READ_REPLICA_URL` too, so mobile analytics
reads land on the replica rather than the primary. Absent it, `getReadDb()`
falls back to the primary — safe, but it quietly loses the benefit.

## Never touches

Any mobile screen. Any web component. You redirect web's imports to the new
package; you do not change what web renders.

## Context you need

`apps/web/src/lib/queries/analytics.ts` holds seven functions the dashboard
reads: `getDashboardStats`, `getVisitSeries`, `getRevenueSeries`,
`getVisitBreakdown`, `getClickBreakdown`, `getProductPerformance`, and the
checkout-methods helper lives next door in `queries/checkout.ts` (A04 owns
that one — leave it).

`apps/web/src/lib/analytics-window.ts` holds the rules that go with them:
`resolveAnalyticsWindow` clamps a requested range against the shop's plan, and
the dashboard caps charts at 60 bars. Those rules are not decoration — read
`apps/web/src/app/admin/page.tsx` to see how they compose.

`setupSteps()` now lives in `@sailo/core` (A00 moved it). It takes a narrow
`SetupSignals` shape, deliberately — read the comment above it.

## Tasks

1. **Create `@sailo/analytics`** and move the seven query functions plus
   `analytics-window.ts` into it. Web imports back. Their existing tests move
   with them and must pass unmodified.

2. **Procedures** in `routers/analytics.ts`:
   - `analytics.stats({ window })` → `getDashboardStats`
   - `analytics.series({ window })` → revenue + visits, 60-bar cap applied
   - `analytics.breakdown({ window })` → visit sources + click breakdown
   - `analytics.products({ window, page })` → `getProductPerformance`

3. **Procedures** in `routers/shop.ts`:
   - `shop.setup` → the four derived steps + progress, from `@sailo/core`
   - `shop.update({ name, description, avatarUrl, logoUrl, socials, accentColor })`
   - `shop.checkHandle({ handle })` → the same `HandleStatus` web returns
   - `shop.create({ ... })` → for A06's sign-up flow

   `shop.get` already exists — leave it.

## Details that must not be missed

- **Plan clamping happens server-side, always.** A hand-typed range in a tRPC
  input must be clamped exactly as `?range=` is on web. Write the test that
  proves a `business`-only window requested by a `free` shop comes back
  clamped, not honoured.
- **No silent caps.** When a window is clamped or a chart truncated to 60 bars,
  the response says so. A09 renders that; you must return it.
- `shop.setup` must count **manual payment rails**, not just Stripe. A
  cash-on-delivery seller is fully set up. `setupSteps` already gets this right
  — feed it `enabledRailCount` from the same function the storefront checkout
  asks, never a second opinion written here.
- `shop.checkHandle` and `shop.create` carry reservation and validation rules
  that live in `actions/shop.ts` today. Extract the domain half; the Server
  Action stays a thin shell. Do not duplicate the handle regex.
- Dates cross the wire as ISO strings — there is no transformer on the mobile
  client. `packages/api/src/client.ts` and `apps/mobile/lib/models.ts` document
  why. Do not add one.
- `shop.update` must not let a client set `plan`, `stripeAccountId`,
  `suspendedAt` or any billing column. Accept an explicit allowlist, never a
  partial spread of the row.

## Done when

- [ ] Existing web analytics tests pass against the moved code, unmodified.
- [ ] The admin dashboard renders identically before and after.
- [ ] A range beyond the shop's plan is clamped server-side, with a test.
- [ ] `shop.setup` returns the same four steps the web dashboard shows for the
      same shop, verified against a real row.
- [ ] `shop.update` rejects an attempt to set `plan`, with a test.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.

## Handoff

PR lists the exact input and output types of every new procedure — A09 and A06
build against them.
