/**
 * The chart palette, now in `@sailo/core/chart`.
 *
 * Re-exported rather than moved-and-rewritten: it is imported by the visx
 * components, the HQ dashboard and the partner chart. It had to leave because
 * `chart/types.ts` depends on it for `ChartTone`, and that file is now shared
 * with the phone — which draws the same series with `react-native-svg`.
 *
 * Pure hex, so both renderers can use the values as well as the type.
 */

export * from "@sailo/core/chart/palette";
