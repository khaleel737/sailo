# A09 — Insights

**Wave:** 2 · **Effort:** M (1.5 weeks) · **Depends on:** A00, A01, A02, A05

## Mission

Tell a seller what happened, honestly — including when nothing did.

## Owns — exclusive write access

- `apps/mobile/app/(tabs)/insights/**`

## Never touches

`index/`, `orders/`, `store/`, `settings/`, `(auth)/`, `checkin/`.
`@sailo/design-native` — request components, don't build them.

## Context you need

A02 exposes `analytics.stats`, `.series`, `.breakdown`, `.products`, with plan
clamping applied server-side and the 60-bar chart cap already handled.

`apps/web/src/lib/plans.ts` defines `ANALYTICS_RANGES` and `analyticsLimit`.
Ranges beyond a shop's plan are **locked, not hidden** — the web admin uses an
upgrade-modal pattern for this. Match the intent: a `free` seller should see
that 90 days exists and what unlocks it.

`@sailo/design-native` exports a `Chart` **primitive** (axes, grid, area,
endpoint). You compose the actual charts from it.

## Screens

- Range segmented control: 7 / 30 / 90 / custom, clamped by plan.
- Stat row: visits, revenue, orders, each with a period-over-period delta.
- Revenue chart: scrubbable area chart, `react-native-svg` + `d3-shape`.
- Traffic sources and countries.
- Top products, paginated.

## Details that must not be missed

- **This is where Stan is weakest and the win is cheapest.** Their app renders
  a `$0 – $0.08` revenue axis on an account with no revenue, and a "Where are
  my customers from?" bar chart containing a single bar labelled "Other: 1".
  Both are charts of nothing with invented precision, and both are the first
  thing a new seller sees.
  **Nothing plots until there is something to plot.** Below a threshold, show
  guidance and a next action instead of a chart.
- **No silent caps.** When a window is clamped by plan or a chart truncated to
  60 bars, the screen says so. A02 returns that information; render it.
- **Numbers must match the web dashboard exactly** for the same shop and
  window. If they differ, the bug is yours — you are reading the same
  functions.
- Scrubbing runs on the **UI thread** via Gesture Handler + Reanimated. A chart
  that lags the finger is worse than a static one.
- Currency and dates format per locale through `formatMoney` and the active
  locale — including RTL, where numerals stay LTR inside mirrored text.
- Deltas need a defined answer for "no previous period" (a new shop) and for
  "previous period was zero" — do not render `∞%` or `NaN`. Stan shows
  "↗100%" on a single visit, which is technically true and useless.
- The chart is not the summary. The stat row is what a seller reads in two
  seconds on a phone; give it the hierarchy.

## Done when

- [ ] A brand-new shop with zero data shows guidance, **not** an invented axis
      and not a single-bar breakdown.
- [ ] Numbers match the web dashboard exactly for the same shop and window.
- [ ] A plan-locked range is visible, locked, and explains what unlocks it.
- [ ] A clamped window says it is clamped.
- [ ] Scrubbing holds 60fps.
- [ ] Deltas render sensibly with no previous period and with a zero previous
      period.
- [ ] Every string from `@sailo/i18n/native`; Arabic RTL correct including
      chart axis direction and money format.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.
