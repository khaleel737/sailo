/**
 * Period-on-period change, guarded against the tiny-base blow-up.
 *
 * One signup last week and two hundred and eleven this week is "+21000%" —
 * a number the HQ overview really did display before it grew this guard,
 * and one the seller analytics page went on displaying because it had its
 * own copy of the arithmetic without the lesson. It reads as a data error,
 * and the fact underneath it — "211, against 1" — is both smaller and more
 * useful. The wording of either answer stays with each app (HQ speaks
 * English; the seller panel speaks 34 languages); the decision lives here.
 */

/**
 * Ten, because that is roughly where a percentage stops swinging wildly on
 * one extra event. Under it, report the counts instead.
 */
export const MIN_BASE_FOR_PERCENT = 10;

/**
 * The rounded percentage change, or null when the previous period is too
 * small to take an honest ratio of — including zero.
 */
export function deltaPercent(current: number, previous: number): number | null {
  if (previous < MIN_BASE_FOR_PERCENT) return null;
  return Math.round(((current - previous) / previous) * 100);
}
