/**
 * Two formatters HQ uses in more than one place.
 *
 * English and `en-GB`, pinned rather than taken from the visitor: /hq is an
 * English panel with `dir="ltr"` nailed on in its layout, and a staff member
 * whose own storefront is in Arabic should not get a different date format in
 * the back office than the colleague sitting next to them — a screenshot in a
 * support thread has to mean the same thing to everybody reading it.
 */

/** `12 Aug` — a day on a chart axis, where the year is noise. */
export function formatDay(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** `12 Aug 2026, 09:04` — a moment, where the year is the point. */
export function formatMoment(value: Date | string | null): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
