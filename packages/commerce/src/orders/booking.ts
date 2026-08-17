/**
 * Reading a booking time from a service order.
 *
 * The picker sends a local-time string. Everything here is defensive: a time
 * in the past, inside the seller's lead time, or simply unparseable comes back
 * as null so the caller can refuse rather than write a booking nobody will
 * keep.
 */

export function parseBooking(
  value: string | undefined,
  leadHours: number,
  now: Date,
): Date | null {
  if (!value?.trim()) return null;

  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return null;

  const earliest = new Date(now.getTime() + Math.max(0, leadHours) * 3_600_000);
  if (when < earliest) return null;

  // A year out is a typo, not a booking.
  const latest = new Date(now.getTime() + 365 * 24 * 3_600_000);
  if (when > latest) return null;

  return when;
}
