"use client";

import type { ChartShape } from "../../chart";

/**
 * Bars or a line, chosen by the reader.
 *
 * Both readings are legitimate and they answer different questions: bars invite
 * comparing one day against another, a line shows the shape of the run. Rather
 * than pick for everyone, the chart ships a default and lets the reader change
 * it — which costs one small control and settles an argument that has no
 * general answer.
 *
 * Real radio inputs rather than buttons with `aria-pressed`: this is a choice
 * between two exclusive options, arrow keys should move between them, and a
 * screen reader should say "1 of 2".
 */
export function VariantSwitch({
  name,
  value,
  onChange,
  labels = { bar: "Bars", line: "Line" },
  legend = "Chart shape",
}: {
  /** Unique per chart, or two charts on a page share one selection. */
  name: string;
  value: ChartShape;
  onChange: (next: ChartShape) => void;
  /*
   * English defaults, for the staff panel and the visual-regression page which
   * are English by design. Every seller-facing chart passes translations —
   * the legend especially, since it is read aloud rather than seen and so
   * nobody notices it staying English.
   */
  labels?: Record<ChartShape, string>;
  legend?: string;
}): React.ReactElement {
  return (
    <fieldset className="shrink-0">
      <legend className="sr-only">{legend}</legend>
      <div className="flex rounded-lg bg-ink-100 p-0.5">
        {(["bar", "line"] as const).map((shape) => {
          const active = value === shape;
          return (
            <label
              key={shape}
              className={`focus-within:ring-2 focus-within:ring-brand-500 flex cursor-pointer items-center justify-center rounded-md px-2 py-1 text-[11px] font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3 ${
                active
                  ? "bg-white text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={shape}
                checked={active}
                onChange={() => onChange(shape)}
                className="sr-only"
              />
              {labels[shape]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
