/**
 * The dashboard's window, as a label and as the string the server parses.
 *
 * Pure, and the reason it is separate is that `utcDay` spells a date the way
 * `resolveAnalyticsWindow` reads it. A local-midnight date here would ask the server for a
 * different day than the one the seller picked, which is invisible until somebody compares the
 * home screen against Insights.
 */



/* -------------------------------------------------------------------------- */
/*  Dates and counts                                                           */
/* -------------------------------------------------------------------------- */

export const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in UTC — the spelling `resolveAnalyticsWindow` parses. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * What the numbers above actually cover, named rather than assumed.
 *
 * `until` is exclusive, so the last day on screen is the one just inside it —
 * the same arithmetic the web dashboard does for its own range label. A window
 * of a single day reads as that day; anything wider reads as both ends, which
 * is what a seller sees when a plan clamp or a rejected input has quietly
 * widened what they asked for.
 *
 * Formatted in UTC, because the bounds are UTC midnights: rendering them in the
 * phone's zone would name a day either side of the one that was counted.
 */
export function windowLabel(
  window: { since: string; until: string; days: number },
  locale: string,
): string {
  const since = new Date(window.since);
  const lastDay = new Date(new Date(window.until).getTime() - 1);
  if (Number.isNaN(since.getTime()) || Number.isNaN(lastDay.getTime())) return "";

  let format: (date: Date) => string;
  try {
    const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
    format = (date) => formatter.format(date);
  } catch {
    // No usable Intl. An ISO day is unambiguous in every locale, which is the
    // property that matters at the point the runtime has stopped helping.
    format = (date) => utcDay(date);
  }

  const oneDay = window.until && new Date(window.until).getTime() - since.getTime() <= DAY_MS;
  return oneDay ? format(since) : `${format(since)} – ${format(lastDay)}`;
}

/**
 * A count, grouped the way the seller's language groups digits.
 *
 * Wrapped for the same reason every other formatter on the phone is: Hermes
 * ships a narrower ICU than a browser's, and an unrecognised locale throws
 * rather than degrading. The bare digits are still a truthful number.
 */
export function count(value: number, locale: string): string {
  try {
    return value.toLocaleString(locale);
  } catch {
    return String(value);
  }
}
