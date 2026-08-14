# Mobile Work Orders — the parallel build list

One file per agent, written to be handed over cold. Each says what it owns,
what it must not touch, what it depends on, the tasks, the details that will
otherwise be missed, and a "done when" you can check.

Sixteen packages. **A00 runs alone and blocks all fifteen others.** After it
merges, Wave 1 and Wave 2 run in parallel with no shared files.

**Sixteen is a work breakdown, not a headcount.** One agent can run them in
sequence; peak useful concurrency is six, set by the number of independent
file-ownership zones. Merge the small ones if you are running fewer agents —
but A00 and A03 stay separate whatever you do.

Every claim in these files was verified against source on 2026-08-13, not
assumed. Where a file says "the router already documents this", it does.

## Rules for every agent, before any work order

1. **Read `AGENTS.md` at the repo root first.** This Next.js has breaking
   changes from your training data. Read the relevant guide in
   `node_modules/next/dist/docs/` before writing app code. The block in
   `AGENTS.md` is rewritten by `next dev` — commit it with your work rather
   than reverting it.

2. **Write only inside your `Owns` paths.** Everything else is read-only,
   including to fix something obviously broken — report it back instead. If
   your work needs a change outside your paths, stop and report a blocked
   dependency. Do not reach across.

3. **Concurrent agents work in this tree.** Stage explicit paths only — never
   `git add -A`. Check `git status` before staging; leave others' files alone.
   One branch per agent, `agent/<id>-<slug>`. Rebase on `main`, never merge
   `main` in.

4. **Verification gate before every commit:**
   `pnpm turbo typecheck` → `pnpm turbo test` → `pnpm turbo lint` →
   `pnpm knip`. All four green **workspace-wide**, not just your package. The
   repo is at knip zero today; keep it there. The 1,730 existing web tests are
   the regression net for every lift out of `apps/web` — they must stay green
   at *every* commit in your branch, not only the last.

5. **A schema change is not shipped until its migration has run against
   production.** Hand-write `apps/web/drizzle/NNNN_<name>.sql`, apply to prod
   first, then push code. Green build/tests/types prove nothing about the
   database. *Note: none of these fifteen work orders should need a migration.
   If yours seems to, stop and report it.*

6. **Never widen tenant scope.** Every tRPC query stays filtered by
   `ctx.shopId` in the `WHERE`, never by an id the client sends. "Not yours"
   and "doesn't exist" both answer `NOT_FOUND` — read the `found()` helper in
   `packages/api/src/router.ts` and the comment above it before adding a
   procedure.

7. **i18n is total.** Mobile strings go through `@sailo/i18n/native` — no
   literals in JSX. Admin keys live in all 35 `packages/i18n/src/admin/*.ts`;
   `en.ts` is the typed source, so missing keys are compile errors. Use that.

8. **Layout is logical, never physical.** `start`/`end`, never `left`/`right`.
   RTL is a shipped requirement, not a later pass — retrofitting it means
   reopening every screen.

9. **Design system only.** Screen agents import from `@sailo/design-native`.
   No raw hex, no `StyleSheet.create` in a screen, no inline styles. Need a
   component that doesn't exist? Request it from A01 — do not build a local one.

10. **Match the house style.** This codebase explains *why* in prose above
    non-obvious code. A silent PR reads as foreign. No new dependency without
    naming it in the PR description with a reason.

11. **No silent caps.** If you bound something — a page size, a retry count, a
    chart window — the UI says so. Clamped or truncated output must admit it.

## Wave structure

| Wave | Agents | Runs | Notes |
|---|---|---|---|
| 0 | A00 | Alone | Blocks everything. 3–5 days. |
| 1 | A01–A05, A15 | Parallel | Foundation. A05 first, A15 early. |
| 2 | A06–A10 | Parallel | Screens. Start against A01's stubs. |
| 3 | A11–A12 | Serial | Harden, then ship. |
| — | A13–A14 | Deferred | Apple + Google login. Ship together or not at all. |

## Known state of the world, 2026-08-14

Verified, not assumed. Read this before dispatching anything.

- **`apps/api` has never been deployed.** No `.vercel` directory; the root one
  points at project `sailo`, which is `apps/web`. Local dev works
  (`pnpm --filter @sailo/api-server dev`, port 3002), so Wave 1 is unblocked —
  but Wave 2 needs a real origin. **A15 fixes this.**
- **`apps/mobile/lib/api.ts` falls back to `https://sailo.store`**, which is the
  web origin and returns 404 for `/api/trpc`. A15 corrects it.
- **There is no `apps/mobile/assets/` directory.** Brand artwork exists at
  `apps/web/public/brand/` (`sailo-mark.svg`, `sailo-logo.svg`, white variants)
  and as vector paths in `apps/web/src/components/brand.tsx`, but the largest
  raster is 512px. A00 generates the icon set **from the SVG**.
- **The mobile app has never been built or run** — only typechecked. A00 is the
  first work order that puts it on a device.
- `apps/api/next.config.ts`'s `transpilePackages` is a deliberate transitive
  closure, not a superset. Any agent adding a package dependency to that app
  must add the entry.

## Build order

| # | Work order | Effort | Wave | Notes |
|---|---|---|---|---|
| 00 | `A00-contracts-and-unblock.md` | M | 0 | **Start here, alone.** Router split + tab shell + design system stubs. |
| 01 | `A01-design-system.md` | L | 1 | Unistyles v3 implementation behind A00's frozen API. |
| 02 | `A02-analytics.md` | M | 1 | `@sailo/analytics` + shop/analytics procedures. |
| 03 | `A03-commerce-lifts.md` | XL | 1 | **Highest risk.** Give to your strongest agent. Fixes a live prod bug first. |
| 04 | `A04-payments-uploads-account.md` | M | 1 | Connect link, Blob tokens, account deletion. |
| 05 | `A05-i18n-native-rtl.md` | S | 1 | **Sequence first.** Blocks every screen agent's first string. |
| 15 | `A15-api-deploy.md` | S–M | 1 | **`apps/api` is undeployed.** Blocks Wave 2 testing against anything real. |
| 16 | `A16-email-package.md` | M–L | 1 | Split out of A03. Blocks A03's booking-email commit. |
| 06 | `A06-auth-screens.md` | L | 2 | Sign-up does not exist today. Net new. |
| 07 | `A07-home-and-orders.md` | L | 2 | Onboarding checklist + the orders surface. |
| 08 | `A08-store-and-product-editor.md` | L | 2 | Product writes + direct uploads. |
| 09 | `A09-insights.md` | M | 2 | Charts with honest empty states. |
| 10 | `A10-checkin-scanner.md` | L | 2 | Camera + offline queue. Native differentiator. |
| 11 | `A11-harden.md` | M | 3 | a11y, tests, perf, Sentry. |
| 12 | `A12-release.md` | M | 3 | Store assets, submission, phased rollout. |
| 13 | `A13-social-server.md` | M | — | Deferred. Inert until A14. |
| 14 | `A14-social-mobile.md` | M | — | Deferred. **Apple is mandatory once Google ships.** |

## What each agent gets

Hand the agent exactly two things:

1. This README (the rules above).
2. Their one work-order file.

Nothing else. Each work order is self-contained by design.

## Reference

The narrative scope behind these orders — the audit, the Stan teardown, the
IA decision and the App Store risks — is a companion document. These files are
the executable half; read them as the source of truth for what gets built.
