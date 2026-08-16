/**
 * The chart's arithmetic, now in `@sailo/design-system/chart`.
 *
 * Re-exported rather than moved-and-rewritten: the visx components next door
 * import `@/lib/chart/domain` and `@/lib/chart/types`, and the maths had to
 * leave because the phone draws the same series with `react-native-svg` and
 * cannot reach into this app.
 *
 * `variations.test.ts` stayed here — it asserts against this app's own chart
 * components, not against the domain.
 */

export * from "@sailo/design-system/chart";
