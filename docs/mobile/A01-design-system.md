# A01 — Design system implementation

**Wave:** 1 · **Effort:** L (2 weeks) · **Depends on:** A00 ·
**Blocks:** nothing (A06–A10 build against A00's stubs)

## Mission

Replace every stub in `@sailo/design-native` with a real, themed, accessible
implementation — without changing a single exported name or prop signature.
Screen agents are building against your API while you work; the contract is
frozen.

## Owns — exclusive write access

- `packages/design-native/**`
- `packages/tokens/**`

## Never touches

Any screen. Any exported component name or prop type — that contract is frozen
by A00. If a screen agent needs something the API can't express, they request
it and you extend *additively*.

## Context you need

Sailo's brand is **green** (`--color-brand-700: #037740`) on a **warm ink**
neutral ramp. The mobile app currently hardcodes `#4f46e5` indigo everywhere —
that is a competitor's colour and every instance goes.

`apps/web/src/app/globals.css` is the reference. Read its comments: the ink
ramp is warm deliberately (there used to be two greys and walking from
marketing into `/admin` read as a different product), `xl` is the control
radius and `2xl` the surface radius, and everything decelerates.

## Tasks

1. **Unistyles v3 runtime.** Theme registration, adaptive mode following the
   system scheme, breakpoints. `app.json` already sets
   `userInterfaceStyle: "automatic"` — dark mode ships from day one, not later.

2. **Three token layers**, and stop there:
   - raw — the ink and brand ramps from `@sailo/tokens`
   - semantic — surface, content, accent, border, danger, success, each with a
     light and a dark value
   - component — button, card, list-row, field

3. **Implement every component.** Variants and slots only. Press, disabled and
   focus states are variants, never ternary style arrays.

4. **Type scale mapped to iOS text styles**, so Dynamic Type works without any
   screen handling it. Route all text through the `Text` component.

5. **Icon registry** — one name maps to an SF Symbol on iOS and a vector
   fallback on Android. Screens never reference a symbol string directly.

6. **Motion.** Reanimated configs built from the three shared easings
   (`ease-out-quint`, `ease-out-expo`, `ease-spring`). Everything runs on the
   UI thread. Every animation honours Reduce Motion.

7. **Lint rule** banning raw hex and inline styles inside `apps/mobile`. Wire
   it into the lint task A00 un-suppressed.

## Details that must not be missed

- **44pt minimum touch targets enforced in the primitives**, not left to
  screens. `Button`, `ListRow`, `Switch` and `Icon`-only controls all need it.
  Web's pattern is `pointer-coarse:min-h-11` — same intent, native expression.
- **Logical properties throughout.** `start`/`end`, never `left`/`right`.
  A05 publishes the RTL rule; you are the layer that makes it true for every
  screen at once.
- `Skeleton` must be **content-shaped**, not a spinner. The screens' loading
  states are only as good as this component.
- `Money` formats through `@sailo/core/currency` and the active locale. Do not
  reimplement `formatMoney`; the mobile `components/money.ts` that exists today
  should fold into this and then be deleted.
- `StatusPill` takes its tone from `@sailo/core/order-status`
  (`orderStatusTone`) — the same source the web badges use. A second colour
  map here is the twin that drifts.
- `Chart` is a primitive (axes, grid, area, endpoint), not a chart. A09 composes
  the actual charts from it.
- Dark mode is not an inversion. Check contrast on both grounds and keep the
  green working on each — `brand-700` on dark needs to lift toward `brand-400`.

## Warning

Unistyles v3 depends on Nitro Modules, so **Expo Go stops working** the moment
this merges. A dev client becomes mandatory for everyone. Document the setup
in your PR — every other agent hits this the moment they pull.

## Done when

- [ ] Every component renders correctly in light and dark, at default and at
      the largest accessibility text size.
- [ ] No screen file changed in this PR.
- [ ] No exported name or prop type changed from A00's published list.
- [ ] Zero raw hex remains in `apps/mobile`; the lint rule proves it.
- [ ] Reduce Motion disables every animation.
- [ ] Token generator output current; CI green.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.

## Handoff

PR states the dev-client setup steps, and lists any component whose
implementation revealed a prop-shape problem — do not fix it unilaterally,
report it so downstream agents can be told.
