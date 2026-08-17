/**
 * Whether a client-supplied string is a uuid, before it reaches a `uuid` column.
 *
 * Postgres raises on a malformed uuid rather than returning nothing, so
 * `{"shopId":"x"}` was a 500 from a public unauthenticated beacon. Takes
 * `unknown` and narrows, so a caller with an optional field does not have to
 * coerce it first — the coercion is where the check gets forgotten.
 *
 * In `@sailo/core` because the tracking beacon, the admin routes and the
 * broadcast segment builder all guard the same way, and they are now in three
 * different packages.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres raises on a malformed uuid rather than returning nothing, so
 * anything a client supplies gets checked before it reaches a `uuid` column.
 * `{"shopId":"x"}` was a 500 from a public unauthenticated beacon.
 *
 * Takes `unknown` and narrows, so a caller with an optional field does not
 * have to coerce it first — the coercion is where the check gets forgotten.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
