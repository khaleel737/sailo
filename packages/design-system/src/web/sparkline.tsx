import { useId } from "react";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear } from "@visx/scale";
import { cn } from "./cn";

/**
 * The little line under a stat's number — Shopify's Analytics grammar: a
 * tile says its figure, and the sparkline says which way the figure has been
 * going without asking for a chart's worth of attention.
 *
 * Drawn with the same visx primitives as the big charts, and still pure
 * server-renderable SVG — `LinePath`/`AreaClosed` are d3-shape wrappers with
 * no state, so the tiles ship no hydration. A monotone curve rather than a
 * polyline: thirty daily points as straight segments read as thirty corners,
 * which is the "dirty line" the old version had.
 *
 * The viewBox still stretches to the tile (`preserveAspectRatio="none"`), and
 * two tricks keep that from showing. Strokes hold their width through
 * `non-scaling-stroke` — and the endpoint dot is a zero-length round-capped
 * *stroke*, not a `<circle>`, because a circle stretches into an ellipse and
 * a stroke cap cannot.
 *
 * Decorative by contract: `aria-hidden`, because the tile's value and hint
 * carry the accessible truth.
 */
export function Sparkline({
  values,
  className,
  color,
}: {
  values: number[];
  className?: string;
  /** A hex from the chart palette — `CHART.money`, `CHART.activity`. */
  color?: string;
}) {
  // Namespaces the gradient: four sparklines share a dashboard, and two
  // `url(#spark)` fills would both resolve to whichever came first.
  const gradientId = useId();

  if (values.length < 2) return null;

  const W = 300;
  const H = 36;
  const PAD = 5;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const flat = max === min;

  const x = scaleLinear({ domain: [0, values.length - 1], range: [PAD, W - PAD] });
  // A constant series has no shape to draw; padding its domain centres the
  // line, which says "steady" where the bottom edge would say "nothing".
  const y = scaleLinear({
    domain: flat ? [min - 1, min + 1] : [min, max],
    range: [H - PAD, PAD],
  });

  const lastX = x(values.length - 1);
  // The guard above promises at least two values, so `at(-1)` cannot miss;
  // the fallback keeps that promise visible to the type system.
  const lastY = y(values.at(-1) ?? 0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden
      preserveAspectRatio="none"
      className={cn("h-9 w-full", className)}
      style={color ? { color } : undefined}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* No wash under a flat line — a half-tile block of tint under a
          "steady" line would claim a magnitude the series doesn't have. */}
      {flat ? null : (
        <AreaClosed
          data={values}
          x={(_, i) => x(i)}
          y={(v) => y(v)}
          yScale={y}
          curve={curveMonotoneX}
          fill={`url(#${gradientId})`}
          stroke="none"
        />
      )}

      <LinePath
        data={values}
        x={(_, i) => x(i)}
        y={(v) => y(v)}
        curve={curveMonotoneX}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />

      {/* The endpoint — the one number a trend line actually asserts is its
          latest one. A white cap under the coloured cap gives the mark its
          2px surface ring, so it stays legible over the wash. */}
      <path
        d={`M ${lastX} ${lastY} l 0.0001 0`}
        stroke="white"
        strokeWidth={9}
        strokeLinecap="round"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M ${lastX} ${lastY} l 0.0001 0`}
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
