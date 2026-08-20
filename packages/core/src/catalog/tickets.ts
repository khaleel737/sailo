/**
 * What an event may be sold in — spec 50's ceilings and its one date rule.
 *
 * Pure, and in `@sailo/core` for the reason `variants.ts` is: the seller's
 * editor is a client component and cannot import the write path, but a ceiling
 * the browser does not know about is a ceiling the seller meets as a silently
 * dropped row. `MAX_VARIANTS` is here for the same reason.
 */

/**
 * Price bands on one event.
 *
 * Far more than any real on-sale uses, and that is not the point: a repeater
 * posting rows a browser composed needs a ceiling before those rows become
 * inserts.
 */
export const MAX_TIERS = 12;

/**
 * Dates one event runs on.
 *
 * A weekly class generated for a year is fifty-two, and a seller with more
 * dates than that is running a venue rather than an event. The same number
 * `generateSessions` clamps its own count to, arrived at from the other side.
 */
export const MAX_SESSIONS = 52;

/**
 * "The same workshop, four Tuesdays" — as wall-clock strings, not instants.
 *
 * **Deliberately not a recurrence rule.** No RRULE, no stored pattern, no
 * infinite series: this returns rows the seller can then edit individually,
 * which is a shape that never has to answer "what does editing the series do to
 * the one you have already sold tickets for". `generateSessions` writes the
 * same thing server-side for a caller that has no editor.
 *
 * The arithmetic runs in UTC on purpose. The input and the output are both
 * `datetime-local` strings — a wall clock with no zone attached — and UTC has
 * no daylight saving, so adding seven days lands on the same weekday at the
 * same clock time every time. Doing it against the browser's own zone would
 * move a 19:00 class to 18:00 for the half of the year on the other side of a
 * clock change, which is precisely what a seller does not mean by "weekly".
 *
 * Answers an empty list for anything that is not the one shape a
 * `datetime-local` input produces, because a blank first date is a seller who
 * has not chosen one yet rather than an error to shout about.
 */
export function repeatWeekly(startsAt: string, count: number): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(startsAt.trim());
  if (!m) return [];

  // The same ceiling the list itself has: one press cannot exceed what the
  // event may hold, and the caller trims again against what it already has.
  const wanted = Math.max(1, Math.min(MAX_SESSIONS, Math.trunc(count)));
  if (!Number.isFinite(wanted)) return [];

  const base = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );

  return Array.from({ length: wanted }, (_, i) =>
    toLocalInput(new Date(base + (i + 1) * 7 * 86_400_000)),
  );
}

/** A UTC instant back as the `YYYY-MM-DDTHH:mm` a browser input reads. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}
