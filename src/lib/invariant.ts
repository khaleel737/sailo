/**
 * Assertions for things the type system can't know but the code depends on.
 *
 * `noUncheckedIndexedAccess` makes `rows[0]` possibly-undefined, which is the
 * truth: an insert can return nothing if it silently did nothing. The tempting
 * fix is `!`, which deletes the question rather than answering it — the value
 * is still undefined at runtime and the failure surfaces somewhere else
 * entirely, as "cannot read properties of undefined" three frames away from
 * the cause.
 *
 * These throw at the point the assumption breaks, naming what was expected.
 */

export class InvariantError extends Error {
  override name = "InvariantError";
}

/** Narrows away null and undefined, or throws saying what was missing. */
export function assertPresent<T>(
  value: T | null | undefined,
  what: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new InvariantError(`Expected ${what}, got ${value}`);
  }
}

/** The same, as an expression. */
export function present<T>(value: T | null | undefined, what: string): T {
  assertPresent(value, what);
  return value;
}

/**
 * The row a write must have produced.
 *
 * `const [row] = await db.insert(...).returning()` is the shape all over this
 * codebase, and an empty result there means the write didn't happen — a
 * conflict clause that matched, a `where` that found nothing. Worth failing on
 * loudly rather than carrying an undefined forward.
 */
export function firstRow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new InvariantError(`Expected ${what} to return a row, got none`);
  }
  return row;
}
