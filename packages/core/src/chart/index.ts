/**
 * The chart's arithmetic, shared by both renderers.
 *
 * Split out of `apps/web/src/lib/chart` when the phone grew an Insights tab.
 * What moved is everything that decides *what the picture means* — the domain,
 * where the peak is, whether there is data at all, how wide a bar may be, and
 * the floor that keeps a zero day visible instead of absent. What stayed behind
 * is everything that decides how it is drawn.
 *
 * That split is the point. `apps/web` draws with visx, which emits DOM SVG and
 * therefore cannot run on React Native; `apps/mobile` draws with
 * `react-native-svg`. Two renderers is unavoidable. Two *domains* would not
 * have been — and a phone and a laptop disagreeing about where the peak is, or
 * about whether a series counts as empty, is the kind of bug a seller reports
 * as "the app says something different from the website".
 */

export * from "./domain";
export * from "./types";
export * from "./cursor";
export * from "./palette";
