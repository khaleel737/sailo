/**
 * A search param, as a single string.
 *
 * `?state=paying&state=free` is legal and arrives as an array; taking the
 * first is the same thing every browser form would have sent. Blank —
 * including whitespace — reads as absent, because `?q=` is a cleared filter,
 * not a filter for the empty string. Four copies of this collapse had grown
 * across the two panels, each with its own fallback.
 */
export function searchParam(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ? raw : undefined;
}
