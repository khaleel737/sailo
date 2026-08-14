import { and, eq, lt, or, type SQL } from "drizzle-orm";
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

export type Cursor = { createdAt: Date; id: string };

/**
 * The wire format: `<iso8601>|<uuid>`, base64url.
 *
 * Encoded rather than sent as an object so a client cannot construct one by
 * hand and go fishing — not that it would reach anything, since every list
 * scopes to `ctx.shopId` in the WHERE regardless. What it really buys is that
 * the shape stays ours to change: A07 and A08 hold these as opaque strings and
 * pass them back, and adding a third component later breaks nobody.
 */
export function encodeCursor(row: Cursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString(
    "base64url",
  );
}

/** Null for anything that isn't one of ours — a bad cursor starts at the top. */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

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
