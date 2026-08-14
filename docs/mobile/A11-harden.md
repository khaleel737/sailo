# A11 — Accessibility, tests, performance

**Wave:** 3 · **Effort:** M (1.5 weeks) · **Depends on:** Wave 2 complete ·
**Blocks:** A12

## Mission

Make the app usable by everyone, provable by CI, and fast enough that nobody
notices it.

## Owns — exclusive write access

- `apps/mobile/**/*.test.tsx`, `apps/mobile/jest.config.js`
- `apps/mobile/maestro/**`
- **Accessibility-only edits anywhere in `apps/mobile`** — labels, roles,
  hints, focus grouping. Not layout, not logic, not copy.

## Never touches

Any package. Any web file. Product behaviour — if an a11y fix requires a
behaviour change, report it rather than making it.

## Context you need

`apps/mobile` has **zero tests** today. `apps/web` has 1,730. The mobile app's
`package.json` has no test script at all — turbo runs nothing for it.

`packages/observability`'s `init()` currently only logs; a Sentry DSN swaps the
sink in without touching a single `captureError` call. That seam already
exists — use it, do not rewrite it.

## Tasks

### Accessibility

- VoiceOver labels on every icon-only control. The tab bar, the scanner's
  torch, the checklist dismiss, every chevron row.
- State and hints exposed — a toggle announces on/off, a busy button announces
  busy, a locked plan range announces why it is locked.
- Logical focus grouping so a list row reads as one element, not five.
- **Dynamic Type verified at the largest accessibility size on every screen.**
  A01 mapped the type scale; you prove nothing clips or overlaps.
- **RTL verified in Arabic across every screen**, not a pseudo-locale.
- Reduce Motion honoured everywhere.
- Colour is never the only carrier of meaning — status pills need their label,
  not just their tone.

### Tests

- `jest-expo` + Testing Library. Add the `test` script so turbo picks it up.
- Cover: the onboarding derivation as rendered, money formatting across
  locales, the optimistic order-status rollback, the offline scan queue's
  exactly-once behaviour, and the auth state machine (signed out → 2FA →
  signed in → signed out clears cache).
- Maestro E2E: sign up → create shop → add product → receive order → change
  status.

### Performance & observability

- Sentry DSN wired through `init()`, with source maps uploaded from EAS so a
  stack trace is readable.
- Record budgets in the PR: cold start, JS bundle size, list FPS at 500 rows.
- Verify `expo-image` cache policy is set on every remote image.
- Confirm A05's locale splitting actually holds in a production build — a dev
  bundle proves nothing about what ships.

## Details that must not be missed

- **Do not "fix" a11y by changing copy or layout.** Report it. A07 owns Home's
  words; you own its labels.
- Test the **money paths** hardest. A wrong price on a phone is a real refund.
- The scan queue test must kill and relaunch the app, not just background it.
- A `429` must not render as a negative answer anywhere — throttled is
  *unknown*. Check every auth and search surface for this.
- Sentry must not capture PII. Scrub emails, handles and order contents from
  breadcrumbs before enabling it.
- Cross-tenant check: sign out, sign in as a different seller, and assert no
  frame ever paints the first seller's data. The existing code clears the query
  cache for exactly this reason — prove it works.

## Done when

- [ ] Every screen navigable and comprehensible with VoiceOver alone.
- [ ] Every screen legible at the largest accessibility text size.
- [ ] Every screen correct in Arabic RTL.
- [ ] `pnpm turbo test` runs mobile tests and they pass.
- [ ] The Maestro flow passes on a real device.
- [ ] Sentry receives a deliberately thrown error with a readable stack trace
      and no PII.
- [ ] Budgets recorded in the PR with measured numbers.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.
