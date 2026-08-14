# A00 — Contracts & unblock

**Wave:** 0 · **Effort:** M (3–5 days) · **Depends on:** nothing ·
**Blocks:** all fourteen other work orders

## Mission

Make the app runnable and publish the contracts fourteen other agents build
against. You create no product surface — you create the shell, the seams and
the type signatures. When this merges, every downstream agent's imports
resolve and the workspace is green.

## Owns — exclusive write access

- `apps/mobile/app/(tabs)/_layout.tsx` and each tab's `_layout.tsx`
- `apps/mobile/app.json`, `apps/mobile/package.json`
- `packages/api/src/router.ts` and the new `packages/api/src/routers/`
- `packages/tokens/**` (new)
- `packages/design-native/**` (new)
- `packages/core/src/onboarding.ts` (moved in)
- `apps/mobile/lib/push.ts` (the notification response listener only)
- `.github/workflows/ci.yml`

## Never touches

Any screen body. Any web component. You move existing screens into place
unchanged and create placeholders — you do not write product UI.

## Context you need

`apps/mobile` is Expo SDK 54 / RN 0.81.5 / expo-router 6, New Architecture on,
and it typechecks clean today. Its data layer (`lib/query.ts`, `lib/api.ts`,
`lib/models.ts`) and push lifecycle (`lib/push.ts`) are well-built — read them,
keep them, copy their patterns.

`app/(tabs)/` currently has **no `_layout.tsx`**, so the tab bar does not
exist and four of the six screens are unreachable. `products/_layout.tsx` is
the only per-tab stack that exists; its comment explains why each tab needs its
own history. Follow that reasoning for the rest.

## Tasks

### 1. Split the router — do this first

`packages/api/src/router.ts` is one 256-line file. Five Wave 1 agents need to
add procedures to it; left as one file they conflict on every push.

Split into `packages/api/src/routers/{shop,products,orders,analytics,payments,events,tickets,account,uploads,push}.ts`
with a thin composition root in `router.ts` that only ever gets appended to.
Behaviour identical. `packages/api/src/router.test.ts` and
`packages/api/src/push.test.ts` must pass **untouched** — if you need to edit a
test, you changed behaviour.

Keep `found()` and the shared zod helpers (`listInput`, `byId`, `pushToken`) in
a `packages/api/src/shared.ts` so every router file imports one copy.

### 2. Tab shell

`(tabs)/_layout.tsx` with five native tabs and SF Symbols:

| Tab | Route | Symbol |
|---|---|---|
| Home | `index` | `house` |
| Orders | `orders` | `bag` |
| Store | `store` | `square.grid.2x2` |
| Insights | `insights` | `chart.bar` |
| Settings | `settings` | `gearshape` |

Per-tab `_layout.tsx` for orders, store, insights and settings. Products'
existing one moves under `store`.

Move the existing `app/index.tsx` dashboard body into a placeholder under
`(tabs)/index/`, and its sign-in half into `app/(auth)/` as a placeholder A06
replaces. Existing orders/products/settings screens move into place unchanged.

### 3. Lift the onboarding derivation

Move `apps/web/src/lib/onboarding.ts` → `packages/core/src/onboarding.ts`.
Its tests (`lib/onboarding.test.ts`) move with it. Web imports it back from
`@sailo/core`. Pure functions, zero dependencies — this is the whole
onboarding-parity requirement in one commit.

### 4. `packages/tokens`

The typed single source. Ink and brand ramps copied **verbatim** from
`apps/web/src/app/globals.css` (`--color-ink-50…950`, `--color-brand-50…950`),
plus radius, spacing and the three motion easings.

Ship the generator that emits both targets:
- a Tailwind `@theme` colour partial imported by `globals.css`
- the Unistyles theme object consumed by `packages/design-native`

Add a CI check that regenerates and fails on a diff. `globals.css` keeps its
prose comments — you generate the colour declarations only, not the file.

### 5. `packages/design-native` — the API surface

**This is the contract that lets Wave 2 start before A01 finishes.**

Export every component below with **final typed props** and a stub body
rendering unstyled React Native primitives:

`Text` · `Button` · `Card` · `ListRow` · `GroupedList` · `StatusPill` ·
`Stat` · `Progress` · `Switch` · `TextField` · `Sheet` · `Skeleton` ·
`EmptyState` · `ErrorState` · `Avatar` · `Icon` · `Segmented` · `Toast` ·
`Money` · `Chart`

Variant and slot props only — no `style` escape hatch on any of them. Get the
prop shapes right; A01 fills the bodies and must not change a single signature.

### 6. App config

There is **no `apps/mobile/assets/` directory at all** — create it.

Source artwork exists and must not be redrawn: `apps/web/public/brand/`
holds `sailo-mark.svg`, `sailo-logo.svg` and white variants, and
`apps/web/src/components/brand.tsx` carries the mark as refitted vector paths
(read its comment — the original auto-trace had 278 curves and a hairline seam;
the refit is the good one). **Generate the icon set from the SVG.** The largest
existing raster is `sailo-mark-512.png` and the App Store needs 1024px —
upscaling that PNG is not acceptable.

`apps/mobile/app.json` needs, all currently absent:

- `icon` (1024px), `splash`, Android `adaptiveIcon`, notification icon + colour
- `ios.infoPlist`: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`
- `ios.associatedDomains` for `sailo.store`, Android `intentFilters`
- `ios.usesAppleSignIn: false` — **reserve it as a documented flag A14 flips**

While you are in the Apple Developer portal generating the icon set, enable the
**Sign in with Apple capability** on the `store.sailo.app` App ID. Two minutes
now; a blocked release later.

### 7. Decide iPad

`supportsTablet: true` is set today. That commits you to iPad screenshots and a
working iPad layout at review. Either constrain readable width properly or set
it `false`. **Record the decision and the reason in the PR.**

### 8. Push tap → navigate

`lib/push.ts` registers tokens and handles permissions correctly, but nothing
listens for a tap. Add a `addNotificationResponseReceivedListener` that routes
to the order detail, and handle the cold-start case
(`getLastNotificationResponseAsync`) — a tap that launches the app from dead
must land on the same screen as one that resumes it.

### 9. Gates

- `apps/mobile/package.json`: drop `|| true` from the lint script. It means
  mobile lint has never been able to fail.
- `.github/workflows/ci.yml`: add `expo-doctor`.
- **`knip.json` cannot see `.tsx` in packages.** The `packages/*` workspace
  declares `"project": ["src/**/*.ts"]` — `.ts` only. `packages/design-native`
  is almost entirely `.tsx`, so the whole design system would be invisible to
  the gate every other agent relies on. Widen it to
  `src/**/*.{ts,tsx}`, and confirm knip still reports zero afterwards rather
  than assuming it will.

## Details that must not be missed

- **The root `Stack` sets `headerShown: false`** because the old dashboard
  painted its own. Pushed detail screens have no header of their own, so each
  per-tab stack must turn headers back on or there is no back button on iOS.
  `products/_layout.tsx` documents this exact trap — read it.
- The tab bar must not be a coloured slab. Native tabs inherit system
  materials; reserve the accent tint for what is interactive.
- `metro.config.js` already solves pnpm workspace resolution and depends on
  `node-linker=hoisted` in `.npmrc`. Do not change either — the comment
  explains what breaks.
- New packages need `transpilePackages` entries in `apps/web/next.config.ts`
  only if web imports them. `@sailo/tokens` will; `@sailo/design-native` will
  not.
- Do not add Unistyles as a dependency here. A01 owns that, and it forces a
  dev client — keep A00 installable in Expo Go so the shell can be smoke-tested
  quickly.

## Done when

- [ ] App launches on a device; all five tabs reachable and switchable.
- [ ] Order detail has a header, a working back button and swipe-back.
- [ ] Tapping an order push notification opens that order, from both a warm
      and a cold start.
- [ ] `import { Button, Card, ListRow } from "@sailo/design-native"`
      typechecks from a screen file.
- [ ] `packages/api/src/router.test.ts` and `push.test.ts` pass unmodified.
- [ ] Token generator output committed; CI fails if it goes stale.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`
      all green workspace-wide.
- [ ] Mobile lint can fail — verify by introducing an error and seeing red.

## Handoff

The PR description must list **every exported component name and its full prop
type** from `@sailo/design-native`. That list is the frozen contract A01
implements against and A06–A10 build against. Also state the iPad decision and
its reason.
