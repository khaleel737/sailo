/**
 * The shape of a shop's opening hours, as it is stored.
 *
 * This lives with the schema, not with the booking logic, because it is a
 * *stored data shape* — a jsonb column on the shop — and the data layer is
 * what owns the shapes it persists. The booking helpers in the app that
 * compute against it import the type from here, inverting the old dependency
 * (logic depends on the stored shape, never the reverse).
 */

/** `09:00` to `17:00`, in the shop's local reckoning. */
export type OpeningWindow = { from: string; to: string };

/** Indexed 0–6, Sunday first, matching `Date.getUTCDay`. */
export type WeeklyHours = OpeningWindow[][];
