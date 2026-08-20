import { cn } from "./cn";

/**
 * The little line under a stat's number — Shopify's Analytics grammar: a
 * tile says its figure, and the sparkline says which way the figure has been
 * going without asking for a chart's worth of attention.
 *
 * Pure server-renderable SVG: normalised into a fixed viewBox, stroke from
 * `currentColor` so the caller picks the ink (`text-brand-600` for money,
 * `text-ink-300` for traffic), a soft fill of the same hue underneath, and
 * an emphasised endpoint — the only number a trend line actually asserts is
 * its latest one.
 *
 * Decorative by contract: `aria-hidden`, because the tile's value and hint
 * carry the accessible truth.
 */
export function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) return null;

  const W = 100;
  const H = 28;
  const PAD = 3;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (values.length - 1);
  const y = (v: number) => H - PAD - ((v - min) * (H - PAD * 2)) / span;

  const points = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const area = `M${PAD},${H - PAD} L${points.join(" L")} L${W - PAD},${H - PAD} Z`;
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]!);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden
      preserveAspectRatio="none"
      className={cn("h-7 w-full", className)}
    >
      <path d={area} fill="currentColor" opacity="0.08" stroke="none" />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="2.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
