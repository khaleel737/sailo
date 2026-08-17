/**
 * Opening an event's access, now in `@sailo/commerce/ticketing`.
 *
 * Kept as a re-export for the callers here. Every module in `ticketing` reads
 * or writes, so that context has one entry rather than two.
 */

export * from "@sailo/commerce/ticketing";
