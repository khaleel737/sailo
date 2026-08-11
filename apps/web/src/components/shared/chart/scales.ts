import type { scaleBand, scaleLinear } from "@visx/scale";

/**
 * The two scale types the chart passes around.
 *
 * Named here so the presentational pieces can take them as props without each
 * one re-deriving the return type of a visx factory in its own signature.
 */
export type ScaleBand = ReturnType<typeof scaleBand<string>>;
export type ScaleLinear = ReturnType<typeof scaleLinear<number>>;
