"use client";

import { useId, useMemo, useState } from "react";
import { localPoint } from "@visx/event";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { indexAtPointer } from "@/lib/chart/cursor";
import { barOffset, barWidth, chartDomain } from "@/lib/chart/domain";
import { formatMoney } from "@/lib/utils";

const PLOT_HEIGHT = 132;
const AXIS_HEIGHT = 22;

/**
 * The affiliate's commission, day by day — the portal's one chart.
 *
 * Not the shared `Chart`: that component is dressed in the admin's ink
 * palette, and this page wears the shop's theme, which the seller may have
 * set dark. Every colour here comes off the surface variables the rest of the
 * portal already uses, and the marks draw in the shop's accent — the same
 * colour the page's stat tiles and buttons speak in. The arithmetic and the
 * interaction grammar (one hit surface, scrub don't hover, a hidden range
 * input so keyboards and screen readers get the same reading) are shared with
 * the admin chart via `lib/chart`, which is the part worth not forking.
 *
 * Orders ride along in the readout but are never drawn: cents and counts on
 * one axis is two charts overlaid, and the admin chart's palette notes explain
 * at length why that lie isn't told there either.
 */
export function PartnerChart({
  days,
  commission,
  orders,
  currency,
  locale,
  labels,
}: {
  /** ISO days, one per column. */
  days: string[];
  /** Cents earned per day, aligned with `days`. */
  commission: number[];
  /** Orders per day, aligned with `days`. */
  orders: number[];
  currency: string;
  locale: string;
  labels: {
    commission: string;
    orders: string;
    empty: string;
    /** Announced on the hidden scrub control. */
    scrub: string;
  };
}): React.ReactElement {
  const [cursor, setCursor] = useState<number | null>(null);
  const cursorId = useId();

  const money = (cents: number) => formatMoney(cents, currency, locale);
  // Midday-safe: a bare date string parses as UTC and can slip a day westward.
  const dayLabel = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    });

  const series = useMemo(
    () => [{ key: "commission", label: labels.commission, values: commission }],
    [commission, labels.commission],
  );
  const domain = useMemo(() => chartDomain(series), [series]);
  const populated = commission.some((v) => v !== 0);

  const totalCommission = commission.reduce((a, b) => a + b, 0);
  const totalOrders = orders.reduce((a, b) => a + b, 0);

  const shownCommission = cursor === null ? totalCommission : (commission[cursor] ?? 0);
  const shownOrders = cursor === null ? totalOrders : (orders[cursor] ?? 0);
  const periodLabel =
    cursor === null ? `${days.length}d` : dayLabel(days[cursor] ?? "");

  return (
    <div>
      <div className="focus-ring-within rounded" style={{ height: PLOT_HEIGHT }}>
        <ParentSize debounceTime={0}>
          {({ width }) =>
            width < 40 ? null : (
              <Plot
                width={width}
                days={days}
                values={commission}
                domain={domain}
                populated={populated}
                cursor={cursor}
                onCursor={setCursor}
                dayLabel={dayLabel}
              />
            )
          }
        </ParentSize>
      </div>

      {populated ? (
        <>
          <label htmlFor={cursorId} className="sr-only">
            {labels.scrub}
          </label>
          <input
            id={cursorId}
            type="range"
            min={0}
            max={Math.max(days.length - 1, 0)}
            step={1}
            value={cursor ?? 0}
            onChange={(event) => setCursor(Number(event.target.value))}
            onBlur={() => setCursor(null)}
            aria-valuetext={`${periodLabel}. ${labels.commission} ${money(shownCommission)}, ${labels.orders} ${shownOrders}`}
            className="sr-only"
          />
        </>
      ) : null}

      <dl className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <dt className="sr-only">Period</dt>
        <dd className="text-muted text-xs font-medium tabular-nums">
          {periodLabel}
        </dd>

        <div className="flex items-baseline gap-1.5">
          <span
            aria-hidden="true"
            className="accent-bg size-2 shrink-0 translate-y-px rounded-full"
          />
          <dt className="text-muted text-xs">{labels.commission}</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {money(shownCommission)}
          </dd>
        </div>

        {/* Counted, not drawn — no dot, because there is no mark to match. */}
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted text-xs">{labels.orders}</dt>
          <dd className="text-sm font-semibold tabular-nums">{shownOrders}</dd>
        </div>
      </dl>

      {populated ? null : (
        <p className="text-muted mt-2 text-center text-xs">{labels.empty}</p>
      )}
    </div>
  );
}

function Plot({
  width,
  days,
  values,
  domain,
  populated,
  cursor,
  onCursor,
  dayLabel,
}: {
  width: number;
  days: string[];
  values: number[];
  domain: { min: number; max: number };
  populated: boolean;
  cursor: number | null;
  onCursor: (index: number | null) => void;
  dayLabel: (day: string) => string;
}): React.ReactElement {
  const innerHeight = PLOT_HEIGHT - AXIS_HEIGHT;

  const xScale = useMemo(
    () => scaleBand({ domain: [...days], range: [0, width], padding: 0.28 }),
    [days, width],
  );
  const yScale = useMemo(
    () =>
      scaleLinear({
        domain: [domain.min, domain.max || 1],
        range: [innerHeight, 0],
        nice: true,
      }),
    [domain, innerHeight],
  );

  const zeroY = yScale(0);

  function track(event: React.PointerEvent<SVGRectElement>): void {
    const point = localPoint(event);
    if (!point) return;
    onCursor(
      indexAtPointer(point.x, {
        offset: 0,
        step: xScale.step(),
        count: days.length,
      }),
    );
  }

  // A mouse leaving has looked away; a lifted finger has just asked its
  // question. Same rule as the admin plot, for the same touch-screen reason.
  function release(event: React.PointerEvent<SVGRectElement>): void {
    if (event.pointerType === "touch") return;
    onCursor(null);
  }

  // First, middle and last day — enough of an axis to place a bar in the
  // month without the tick machinery the admin chart carries.
  const ticks = [
    { index: 0, anchor: "start" as const },
    { index: Math.floor((days.length - 1) / 2), anchor: "middle" as const },
    { index: days.length - 1, anchor: "end" as const },
  ].filter((t, i, all) => all.findIndex((o) => o.index === t.index) === i);

  return (
    <svg
      width={width}
      height={PLOT_HEIGHT}
      className="overflow-visible"
      // Without this a drag on a touch screen scrolls the page instead of
      // scrubbing the chart, and pointermove stops arriving mid-gesture.
      style={{ touchAction: "pan-y" }}
    >
      {populated
        ? yScale.ticks(3).map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={width}
              y1={yScale(tick)}
              y2={yScale(tick)}
              stroke="var(--surface-border)"
            />
          ))
        : null}

      <line
        x1={0}
        x2={width}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--surface-border)"
        strokeWidth={1}
      />

      {/* The day under the cursor, marked behind the bars it explains. */}
      {cursor !== null ? (
        <rect
          x={
            (xScale(days[cursor] ?? "") ?? 0) -
            (xScale.step() - xScale.bandwidth()) / 2
          }
          y={0}
          width={xScale.step()}
          height={innerHeight}
          fill="var(--surface-elevated)"
          rx={3}
        />
      ) : null}

      {populated
        ? days.map((day, i) => {
            const value = values[i] ?? 0;
            // A real value must never round away to an invisible sliver; a
            // zero day still draws a tick so the column reads present.
            const height = Math.max(
              Math.abs(yScale(value) - zeroY),
              value === 0 ? 1 : 2,
            );
            return (
              <rect
                key={day}
                x={(xScale(day) ?? 0) + barOffset(xScale.bandwidth())}
                y={yScale(value)}
                width={barWidth(xScale.bandwidth())}
                height={height}
                rx={2}
                fill={value === 0 ? "var(--surface-border)" : "var(--accent)"}
                className="transition-opacity duration-150 ease-out"
                opacity={cursor === null || cursor === i ? 1 : 0.45}
              />
            );
          })
        : null}

      {populated ? (
        <rect
          x={0}
          y={0}
          width={width}
          height={innerHeight}
          fill="transparent"
          onPointerMove={track}
          onPointerDown={track}
          onPointerLeave={release}
          onPointerCancel={() => onCursor(null)}
        />
      ) : null}

      {populated
        ? ticks.map((tick) => (
            <text
              key={tick.index}
              x={
                tick.anchor === "start"
                  ? 0
                  : tick.anchor === "end"
                    ? width
                    : width / 2
              }
              y={PLOT_HEIGHT - 6}
              textAnchor={tick.anchor}
              fontSize={10}
              fill="var(--surface-muted)"
            >
              {dayLabel(days[tick.index] ?? "")}
            </text>
          ))
        : null}
    </svg>
  );
}
