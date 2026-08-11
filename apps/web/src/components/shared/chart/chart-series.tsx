import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { Bar, LinePath } from "@visx/shape";
import { chartColour } from "@/lib/chart-palette";
import { barOffset, barWidth } from "@/lib/chart/domain";
import type { ChartShape, ChartTone, Series } from "@/lib/chart/types";
import type { ScaleBand, ScaleLinear } from "./scales";

/**
 * The marks themselves — and every one of them in the same shape.
 *
 * Split out because this is the part that changes when a new shape is wanted,
 * while the axes, grid and cursor around it do not.
 */
export function ChartSeries({
  series,
  days,
  shape,
  tone,
  xScale,
  yScale,
  barScales,
  cursor,
}: {
  series: readonly Series[];
  days: readonly string[];
  shape: ChartShape;
  tone: ChartTone;
  xScale: ScaleBand;
  yScale: ScaleLinear;
  /** One band per side of the axis; see the note in `chart-plot`. */
  barScales: { above: ScaleBand; below: ScaleBand };
  cursor: number | null;
}): React.ReactElement {
  const zeroY = yScale(0);

  const centre = (index: number): number =>
    (xScale(days[index] ?? "") ?? 0) + xScale.bandwidth() / 2;

  /** A series' value for a day, flipped negative when it is money leaving. */
  const valueAt = (s: Series, index: number): number => {
    const raw = s.values[index] ?? 0;
    return s.negative ? -Math.abs(raw) : raw;
  };

  return (
    <>
      {series.map((s, seriesIndex) => {
        const colour = chartColour(tone, s.depth ?? seriesIndex);

        switch (shape) {
          case "line":
            return (
              <Group key={s.key}>
                <LinePath
                  data={days.map((_, i) => i)}
                  x={centre}
                  y={(i) => yScale(valueAt(s, i))}
                  stroke={colour}
                  strokeWidth={2}
                  strokeLinecap="round"
                  curve={curveMonotoneX}
                  fill="none"
                />
                {cursor === null ? null : (
                  <circle
                    cx={centre(cursor)}
                    cy={yScale(valueAt(s, cursor))}
                    r={3.5}
                    fill={colour}
                    stroke="white"
                    strokeWidth={1.5}
                  />
                )}
              </Group>
            );

          case "bar": {
            const lane = s.negative ? barScales.below : barScales.above;
            return (
              <Group key={s.key}>
                {days.map((day, i) => {
                  const value = valueAt(s, i);
                  // A real value must never round away to an invisible sliver;
                  // a zero day still draws a tick so the column reads present.
                  const height = Math.max(
                    Math.abs(yScale(value) - zeroY),
                    value === 0 ? 1 : 2,
                  );

                  return (
                    <Bar
                      key={day}
                      x={
                        (xScale(day) ?? 0) +
                        (lane(s.key) ?? 0) +
                        barOffset(lane.bandwidth())
                      }
                      y={value >= 0 ? yScale(value) : zeroY}
                      width={barWidth(lane.bandwidth())}
                      height={height}
                      rx={2}
                      // The warm neutral, not a cool grey among warm ink.
                      fill={value === 0 ? "var(--color-ink-200)" : colour}
                      // Without this, columns snap between two opacities as the
                      // pointer crosses and the card reads as flicker.
                      className="transition-opacity duration-150 ease-out"
                      opacity={cursor === null || cursor === i ? 1 : 0.45}
                    />
                  );
                })}
              </Group>
            );
          }

          default: {
            // A new shape must be handled here, not silently dropped: the
            // compiler fails this line the moment ChartShape grows a member.
            const exhaustive: never = shape;
            return exhaustive;
          }
        }
      })}
    </>
  );
}
