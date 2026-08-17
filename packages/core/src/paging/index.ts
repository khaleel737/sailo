/**
 * Paging a list that is still being written to.
 *
 * Offset paging is wrong here and quietly so. Orders and products come back
 * `createdAt desc`, which means new rows arrive at the *front*: a seller who
 * scrolls their orders while an order comes in asks for rows 50–99 of a list
 * that has shifted by one, and row 49 — an order they have never seen — is
 * skipped. Nothing errors. They simply never find out it exists.
 *
 * So the cursor is the last row itself rather than a count of rows passed, and
 * `./cursor` is the one implementation of it. The SQL predicate that consumes it
 * stays in `@sailo/commerce/pagination`, because that needs drizzle columns and
 * this package has no database in it.
 */
export * from "./cursor";
