import { describe, expect, it, vi } from "vitest";

/**
 * The property that made this keyset rather than offset: a page boundary that
 * does not move when the list does.
 *
 * A seller scrolling their orders is scrolling a list being written to from the
 * front — someone is buying something while they scroll. Under offset paging,
 * asking for rows 50–99 after one new order arrives returns a window shifted by
 * one, and the order that was row 49 is never shown to anybody. It does not
 * error and it does not look wrong. This file walks a list while writing to it
 * and asserts, row by row, that nothing is seen twice and nothing is missed.
 *
 * `olderThan` builds drizzle operators, so the operators are what is stubbed:
 * `and`/`or`/`lt`/`eq` become predicates over a plain object, the same tagging
 * trick `router.test.ts` uses to read back a WHERE. What runs is the real
 * composition — `or(lt(createdAt), and(eq(createdAt), lt(id)))` — against real
 * rows, rather than a second copy of the rule written for the test.
 */

vi.mock("drizzle-orm", () => {
  type Row = Record<string, unknown>;
  type Pred = (row: Row) => boolean;
  const kept = (parts: (Pred | undefined)[]) => parts.filter(Boolean) as Pred[];
  /*
   * Compared by value, because that is what `=` does to a `timestamp`.
   *
   * The cursor's date is parsed back out of an ISO string, so it is never the
   * same object as the row's — `===` on two Dates is identity and would have
   * made the tie-break silently unreachable here while working perfectly in
   * Postgres. A stub that is wrong in the caller's favour is worse than none.
   */
  const val = (v: unknown) => (v instanceof Date ? v.getTime() : v);
  return {
    and: (...parts: (Pred | undefined)[]): Pred =>
      (row) => kept(parts).every((p) => p(row)),
    or: (...parts: (Pred | undefined)[]): Pred =>
      (row) => kept(parts).some((p) => p(row)),
    lt: (column: string, value: unknown): Pred =>
      (row) => (val(row[column]) as never) < (val(value) as never),
    eq: (column: string, value: unknown): Pred =>
      (row) => val(row[column]) === val(value),
  };
});

const { decodeCursor, decodeCursorOrTop, encodeCursor, olderThan, pageOf } =
  await import("./pagination");

type Row = { id: string; createdAt: Date; label: string };

// Columns are their own names here — see the drizzle stub above.
const COLUMNS = { createdAt: "createdAt", id: "id" } as never;

/**
 * A row id that a `uuid` column could actually hold.
 *
 * These were `id-001`, `id-002` — and that is why this file never caught the
 * defect it was closest to. `decodeCursor` had two implementations and only one
 * checked that the id was uuid-shaped, because `olderThan` below puts it into a
 * comparison against a `uuid` column and Postgres raises on a malformed one. A
 * fixture using ids the real column cannot store is a fixture that cannot tell
 * the two decoders apart.
 *
 * The ordering assertions still work, because a zero-padded counter in the last
 * field sorts the same way `id-001` did.
 */
function uuidFor(n: number): string {
  return `6f1d2b7e-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function row(n: number, ms: number, label = `row-${n}`): Row {
  return { id: uuidFor(n), createdAt: new Date(ms), label };
}

/** The list as the database would return it: newest first, ties broken by id. */
function ordered(rows: Row[]): Row[] {
  return [...rows].toSorted(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
  );
}

/**
 * One page, the way the router asks for it: `limit + 1`, then `pageOf`.
 *
 * `decodeCursorOrTop` rather than `decodeCursor` because every cursor this
 * harness passes is one it just encoded. The router itself uses `cursorFrom`,
 * which refuses a malformed one with `BAD_REQUEST` — pinned in
 * `packages/api/src/cursor-refusal.test.ts`, where the router lives.
 */
function page(rows: Row[], cursor: string | null, limit: number) {
  const predicate = olderThan(COLUMNS, decodeCursorOrTop(cursor)) as unknown as
    | ((r: Row) => boolean)
    | undefined;
  const matching = ordered(rows).filter((r) => !predicate || predicate(r));
  return pageOf(matching.slice(0, limit + 1), limit);
}

describe("the cursor", () => {
  it("survives a round trip", () => {
    const there = { createdAt: new Date("2026-08-14T09:41:07.221Z"), id: uuidFor(7) };
    expect(decodeCursor(encodeCursor(there))).toEqual(there);
  });

  /*
   * A STALE CURSOR IS NOT A MALFORMED ONE, AND THIS TEST USED TO CONFLATE THEM
   *
   * The version of this that asserted `decodeCursor(junk) === null` reasoned that
   * "clients hold on to stale ones — across an app update, a logout, a paste.
   * None of these may 500 a list screen." The concern is right and the conclusion
   * was too broad, which is how the shape check went missing.
   *
   * A cursor we issued and a client kept is still `<iso8601>|<uuid>`: it decodes,
   * and `olderThan` compares against a timestamp, so it does not matter whether
   * the row it names still exists. Nothing about staleness is malformed.
   *
   * Garbage is a different thing. `"../../etc"` was never a cursor, and the id
   * half of a malformed one reaches `lt(column, id)` against a `uuid` column —
   * which is a 500 rather than an empty page. So garbage is refused, and a caller
   * that genuinely wants the first page instead says so with `decodeCursorOrTop`.
   */
  it("reads a stale cursor of ours without complaint", () => {
    const longAgo = { createdAt: new Date("2019-01-01T00:00:00.000Z"), id: uuidFor(1) };
    expect(decodeCursor(encodeCursor(longAgo))).toEqual(longAgo);
  });

  it.each(["!!!!", "Zm9v", "../../etc"])("refuses %s, which was never a cursor", (junk) => {
    expect(decodeCursor(junk)).toBe("invalid");
  });

  it.each(["", null, undefined])("still treats %s as the first page", (absent) => {
    expect(decodeCursor(absent)).toBeNull();
  });

  it("offers the first page to a caller that cannot report a refusal", () => {
    expect(decodeCursorOrTop("../../etc")).toBeNull();
  });
});

describe("pageOf", () => {
  it("hands back the page without the row that proved there was more", () => {
    const rows = [row(1, 300), row(2, 200), row(3, 100)];
    const { items, nextCursor } = pageOf(rows, 2);
    expect(items.map((r) => r.id)).toEqual([uuidFor(1), uuidFor(2)]);
    // The cursor is the last row *kept*, not the one that overflowed.
    expect(decodeCursorOrTop(nextCursor)?.id).toBe(uuidFor(2));
  });

  it("says the list is finished rather than leaving it to be guessed", () => {
    // A page can come back short for reasons other than the end, so "there is
    // no more" is stated rather than inferred from `items.length < limit`.
    expect(pageOf([row(1, 300), row(2, 200)], 2).nextCursor).toBeNull();
    expect(pageOf([], 2).nextCursor).toBeNull();
  });
});

describe("walking a list that is being written to", () => {
  it("shows every row exactly once when nothing changes", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(i, 1_000 - i * 10));
    const seen: string[] = [];

    let cursor: string | null = null;
    for (;;) {
      const result: { items: Row[]; nextCursor: string | null } = page(
        rows,
        cursor,
        3,
      );
      seen.push(...result.items.map((r) => r.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    expect(seen).toEqual(ordered(rows).map((r) => r.id));
  });

  it("skips nothing and repeats nothing when a row lands mid-scroll", () => {
    /*
     * The whole point. Two pages in, an order arrives — newer than everything,
     * so it sorts to the very front, which is exactly where offset paging would
     * have pushed an unseen row across the boundary.
     */
    const original = Array.from({ length: 10 }, (_, i) => row(i, 1_000 - i * 10));
    const live = [...original];
    const seen: string[] = [];

    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const result: { items: Row[]; nextCursor: string | null } = page(
        live,
        cursor,
        3,
      );
      seen.push(...result.items.map((r) => r.id));
      pages += 1;
      if (pages === 2) live.unshift(row(99, 5_000, "arrived mid-scroll"));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    // Nothing twice.
    expect(seen).toEqual([...new Set(seen)]);
    // And nothing missed: every row that existed when the scroll started was
    // shown. The one that arrived after it is legitimately absent — it sorted
    // above a boundary already passed, and a pull-to-refresh is what finds it.
    for (const r of original) expect(seen, r.id).toContain(r.id);
  });

  it("does not lose the tail of a millisecond several rows share", () => {
    /*
     * `createdAt` is not unique — a CSV import writes a batch inside one
     * millisecond. A cursor holding only the timestamp either re-serves that
     * whole batch or skips the rest of it, which is why the id is in the key.
     */
    const rows = [
      row(1, 500),
      row(2, 300),
      row(3, 300),
      row(4, 300),
      row(5, 300),
      row(6, 100),
    ];
    const seen: string[] = [];

    let cursor: string | null = null;
    for (;;) {
      const result: { items: Row[]; nextCursor: string | null } = page(
        rows,
        cursor,
        2,
      );
      seen.push(...result.items.map((r) => r.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    expect(seen).toEqual(ordered(rows).map((r) => r.id));
    expect(seen).toHaveLength(6);
  });
});
