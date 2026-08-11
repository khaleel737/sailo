/**
 * The arithmetic behind a batched catalogue.
 *
 * Kept apart from the query itself, and free of any database import, because
 * these two functions are where batching goes wrong quietly. An off-by-one in
 * `nextOffsetFor` either strands the last batch — the shopper scrolls and
 * nothing more arrives, though the shop has more to sell — or never
 * terminates, asking forever for products that aren't there. And `orderByIds`
 * is what keeps the order SQL chose after the relations are loaded separately;
 * get it wrong and the sort the shopper picked is quietly ignored.
 *
 * Neither needs a database to be wrong, so neither needs one to be tested.
 */

/**
 * Where the next batch starts, or null when this one reached the end.
 *
 * `total` is every match for the filter, so this stays right when the last
 * batch comes back short.
 */
export function nextOffsetFor(
  offset: number,
  batchSize: number,
  total: number,
): number | null {
  // A batch that came back empty is the end, whatever the count claims. The
  // count and the batch are two queries, and a product unpublished between
  // them would otherwise leave the client asking for a page that never comes.
  if (batchSize <= 0) return null;

  const next = offset + batchSize;
  return next < total ? next : null;
}

/**
 * Rebuilds `rows` into the order given by `ids`.
 *
 * The batch is chosen by one query and its relations loaded by another, and
 * `IN (...)` has no order of its own — so without this the shopper's chosen
 * sort survives only as far as the second query, which returns rows in
 * whatever order the planner found them.
 *
 * An id with no row is skipped rather than left as a hole: between the two
 * queries a product can be deleted, and a gap in the grid is worse than a
 * batch one card short.
 */
export function orderByIds<T extends { id: string }>(
  ids: readonly string[],
  rows: readonly T[],
): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered: T[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) ordered.push(row);
  }
  return ordered;
}
