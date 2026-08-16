import { Circle, Group, Path, RoundedRect } from "@shopify/react-native-skia";
import { createRoundedRectPath, type Scale } from "victory-native";
import { barOffset, barWidth } from "../../chart";
import type { DrawnSeries } from "./rows";

/**
 * The marks themselves, and every one of them in the same shape.
 *
 * Split out for the reason the web's `chart-series.tsx` is split out: this is
 * the part that changes when a new shape is wanted, and the grid, axis and
 * cursor around it do not.
 *
 * ONE SHAPE, NEVER TWO
 * `shape` is a property of the chart and never of a series. An earlier version
 * of the web chart carried it per series, so a revenue card drew sales as bars
 * and net as a line in one frame — which reads as two charts overlaid rather
 * than one measure summarising another, and leaves no honest answer to which
 * one the axis belongs to.
 *
 * A NOTE ON DIRECTION
 * The corner names below are physical — `topLeft`, `bottomRight` — where the
 * rest of this package refuses anything but `start` and `end`. That is correct
 * here and only here: a time axis runs left to right in every locale this app
 * ships, Arabic included, because it is a number line rather than a line of
 * text. The web chart does not mirror either, and a phone that disagreed with
 * the laptop about which end of the week was Monday would be a worse bug than
 * the one the rule prevents.
 */

/** How round a bar's leading corners are. Matches `radius.lg` at bar scale. */
const BAR_RADIUS = 3;

/** The smallest a real bar may draw, so a genuine value is never invisible. */
const MIN_BAR_PX = 2;
/** What a zero day draws, so the column still reads as present rather than absent. */
const ZERO_BAR_PX = 1;

export type MarksProps = {
  drawn: readonly DrawnSeries[];
  /** One band per day, already split above and below the axis. */
  bands: { left: number; step: number; count: number };
  yScale: Scale;
  shape: "bar" | "line";
  /** The day under the reader's finger, or null. Dims everything else. */
  cursor: number | null;
  /** What a zero-valued column is painted in — a neutral, never the tone. */
  emptyColour: string;
  /** The ring around the cursor dot, so it reads as a marker over the line. */
  surfaceColour: string;
};

export function Marks({
  drawn,
  bands,
  yScale,
  shape,
  cursor,
  emptyColour,
  surfaceColour,
}: MarksProps) {
  const zeroY = yScale(0);

  /*
   * Bars share a day's column only with bars that could overlap them, which
   * means bars on the same side of the axis. Grouping sales against refunds
   * halved both, and at thirty days that left a four-pixel sliver each.
   */
  const above = drawn.filter((d) => !d.negative);
  const below = drawn.filter((d) => d.negative);

  return (
    <Group>
      {drawn.map((entry) =>
        shape === "bar" ? (
          <BarSeries
            key={entry.series.key}
            entry={entry}
            lane={laneOf(entry, above, below, bands.step)}
            bands={bands}
            yScale={yScale}
            zeroY={zeroY}
            cursor={cursor}
            emptyColour={emptyColour}
          />
        ) : (
          <LineSeries
            key={entry.series.key}
            entry={entry}
            bands={bands}
            yScale={yScale}
            cursor={cursor}
            surfaceColour={surfaceColour}
          />
        ),
      )}
    </Group>
  );
}

/** Where in its day's column this series' bar sits, and how wide it may be. */
type Lane = { offset: number; width: number };

function laneOf(
  entry: DrawnSeries,
  above: readonly DrawnSeries[],
  below: readonly DrawnSeries[],
  step: number,
): Lane {
  const siblings = entry.negative ? below : above;
  const position = siblings.indexOf(entry);
  /*
   * A little of the column is always left as a gutter, so two days' bars never
   * touch. 0.72 is the same proportion the web's band scale reaches with
   * `padding: 0.28`, kept as a number rather than a scale because there is one
   * band here and no need for d3 to compute it.
   */
  const usable = step * 0.72;
  const share = usable / Math.max(1, siblings.length);
  /*
   * `barWidth` caps a bar at 40pt and `barOffset` re-centres what it takes
   * away. Both live in `@sailo/design-system/chart` because the rule they encode is a
   * product one: a one-day window hands its only column nearly the whole card,
   * and a $249 sale drawn as a slab half the width of its own chart reads as a
   * broken layout rather than as one good day.
   */
  const width = barWidth(share);
  const gutter = (step - usable) / 2;
  return { offset: gutter + position * share + barOffset(share), width };
}

function BarSeries({
  entry,
  lane,
  bands,
  yScale,
  zeroY,
  cursor,
  emptyColour,
}: {
  entry: DrawnSeries;
  lane: Lane;
  bands: MarksProps["bands"];
  yScale: Scale;
  zeroY: number;
  cursor: number | null;
  emptyColour: string;
}) {
  return (
    <Group>
      {Array.from({ length: bands.count }, (_, index) => {
        const raw = entry.series.values[index] ?? 0;
        const value = entry.negative ? -Math.abs(raw) : raw;
        const y = yScale(value);

        // A real value must never round away to an invisible sliver; a zero day
        // still draws a tick so the column reads present rather than missing.
        const height = Math.max(Math.abs(y - zeroY), value === 0 ? ZERO_BAR_PX : MIN_BAR_PX);
        const top = value >= 0 ? Math.min(y, zeroY) : zeroY;
        const x = bands.left + index * bands.step + lane.offset;

        /*
         * Only the leading corners are rounded — the end that grows. Rounding
         * the baseline too lifts every bar off the zero line by a pixel of
         * background, and thirty of those read as a chart floating above its
         * own axis.
         */
        const corners = entry.negative
          ? { bottomLeft: BAR_RADIUS, bottomRight: BAR_RADIUS }
          : { topLeft: BAR_RADIUS, topRight: BAR_RADIUS };

        return (
          <RoundedRect
            key={index}
            rect={createRoundedRectPath(x, top, lane.width, height, corners, value)}
            color={value === 0 ? emptyColour : entry.colour}
            /*
             * The day being read stays lit and its neighbours step back. Not a
             * hard hide: the shape of the week is the context that makes one
             * day mean anything, and dropping it while the reader points at a
             * column answers a narrower question than they asked.
             */
            opacity={cursor === null || cursor === index ? 1 : 0.4}
          />
        );
      })}
    </Group>
  );
}

function LineSeries({
  entry,
  bands,
  yScale,
  cursor,
  surfaceColour,
}: {
  entry: DrawnSeries;
  bands: MarksProps["bands"];
  yScale: Scale;
  cursor: number | null;
  surfaceColour: string;
}) {
  const centre = (index: number) => bands.left + index * bands.step + bands.step / 2;
  const valueAt = (index: number) => {
    const raw = entry.series.values[index] ?? 0;
    return entry.negative ? -Math.abs(raw) : raw;
  };

  /*
   * Straight segments, where the web curves with `curveMonotoneX`.
   *
   * That is a deliberate divergence and the older mobile chart made the same
   * one for the same reason: a curve is right for a wide plot with room between
   * points, and at phone width sixty days sit a few pixels apart, where a
   * spline reads as noise while inventing values between the days that were
   * actually measured. The web card is three times as wide and has the room.
   */
  const path = Array.from({ length: bands.count }, (_, index) => {
    const command = index === 0 ? "M" : "L";
    return `${command} ${centre(index)} ${yScale(valueAt(index))}`;
  }).join(" ");

  return (
    <Group>
      <Path
        path={path}
        color={entry.colour}
        style="stroke"
        strokeWidth={2}
        strokeCap="round"
        strokeJoin="round"
      />
      {/*
        The dot on the day being read. Ringed in the card's own surface colour
        rather than in white, which is a ring nobody can see in dark mode and
        the reason the marker used to disappear exactly when it was wanted.
      */}
      {cursor === null ? null : (
        <Group>
          <Circle cx={centre(cursor)} cy={yScale(valueAt(cursor))} r={5} color={surfaceColour} />
          <Circle cx={centre(cursor)} cy={yScale(valueAt(cursor))} r={3.5} color={entry.colour} />
        </Group>
      )}
    </Group>
  );
}
