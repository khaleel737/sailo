/**
 * What replaces a seller's identity when the row has to survive them.
 *
 * Pure, and its own file for that reason: these two strings are written into a live
 * `shops` row and a live `user` row, and both have to satisfy constraints declared
 * somewhere else — the handle validator in `@sailo/core/handle`, and the requirement
 * that the address can never receive mail. Neither constraint is expressible in the
 * type system, so both are asserted in `./tombstone.test.ts`, which needs no database.
 */

/**
 * A handle nobody will ever type, inside the rules `validateHandleFormat`
 * enforces: `HANDLE_MAX` is 32, and a trailing dash is rejected — so the
 * uuid's hyphens come out and the hex is cut to fit exactly.
 */
export function tombstoneHandle(shopId: string): string {
  return `deleted-${shopId.replace(/-/g, "").slice(0, 24)}`;
}

/** An address at a domain that can never receive mail. RFC 2606 reserves it. */
export function tombstoneEmail(userId: string): string {
  return `deleted-${userId}@sailo.invalid`;
}
