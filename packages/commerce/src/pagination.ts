import { and, eq, lt, or, type SQL } from "drizzle-orm";
import { encodeCursor, type Cursor } from "@sailo/core/paging";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Paging a list that is still being written to.
 *
 * Offset paging is wrong here and quietly so. Orders and products come back
 * `createdAt desc`, which means new rows arrive at the *front*: a seller who
 * scrolls their orders while an order comes in asks for rows 50–99 of a list
 * that has shifted by one, and row 49 — an order they have never seen — is
 * skipped. Nothing errors. They simply never find out it exists.
 *
 * So the cursor is the last row itself rather than a count of rows passed.
 * "Everything older than this exact row" is a question whose answer does not
 * depend on what happened at the top of the list, so a write landing mid-scroll
 * can neither duplicate a row nor hide one.
 *
 * `createdAt` alone is not enough. It is not unique — an import writes fifty
 * rows in the same millisecond — so a cursor holding only the timestamp either
 * skips the rest of that millisecond or repeats it. The key is
 * `(createdAt, id)`, compared as a pair.
 */

/*
 * The cursor itself is `@sailo/core/paging` — one implementation, because there
 * were two and only one of them checked that the id was uuid-shaped. `olderThan`
 * below puts that id into a comparison against a `uuid` column and Postgres
 * raises on a malformed one, so the loose copy turned a bad cursor into a 500
 * where the strict copy answered 400. See that module's header.
 *
 * What stays here is the half that needs drizzle: the predicate and the
 * over-fetch split. `@sailo/core` has no database in it and should not grow one.
 *
 * Re-exported so every existing importer of `@sailo/commerce/pagination` keeps
 * resolving — but `decodeCursor` now returns `"invalid"` as a third state, and
 * the compiler makes each caller say what that means to it.
 */
export {
  decodeCursor,
  decodeCursorOrTop,
  encodeCursor,
  type Cursor,
} from "@sailo/core/paging";

/**
 * "Strictly older than the cursor row", in the same order the list is sorted.
 *
 * Written with drizzle's own operators rather than a row-value comparison —
 * `(a, b) < (c, d)` is tighter SQL, but it sends the id as an untyped parameter
 * next to a `uuid` column and what Postgres infers there depends on the driver.
 * This form is unambiguous and reads as the rule it is.
 *
 * Returns undefined for the first page, which drizzle drops from an `and(...)`.
 */
export function olderThan(
  columns: { createdAt: PgColumn; id: PgColumn },
  cursor: Cursor | null,
): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(columns.createdAt, cursor.createdAt),
    // The tie-break, and the reason the id is in the cursor at all.
    and(eq(columns.createdAt, cursor.createdAt), lt(columns.id, cursor.id)),
  );
}

/**
 * Splits an over-fetched batch into the page and the cursor after it.
 *
 * Call the query with `limit + 1`. Getting the extra row back is how "there is
 * more" is known without a second `count(*)` over the whole table, and a
 * `nextCursor` of null is the honest end of the list rather than a client
 * guessing from a short page — a page can come back short for other reasons.
 */
export function pageOf<T extends Cursor>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    items,
  };
}
