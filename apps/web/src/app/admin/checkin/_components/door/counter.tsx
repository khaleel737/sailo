"use client";

/**
 * How many are in, out of how many sold.
 */



export function Counter({
  value,
  label,
  tone,
  muted,
}: {
  value: number;
  label: string;
  tone?: "in";
  muted?: boolean;
}) {
  return (
    <div>
      <p
        className={`tabular text-3xl font-bold leading-none ${
          tone === "in"
            ? "text-emerald-600"
            : muted
              ? "text-ink-400"
              : "text-ink-900"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-ink-500">{label}</p>
    </div>
  );
}
