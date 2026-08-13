import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The rules that make hand-applied migrations survivable.
 *
 * Nothing applies `drizzle/*.sql` automatically — there is no journal and
 * `db:push` diffs the schema rather than running these files. That is a
 * workable arrangement, but only while the directory holds to a few properties
 * that are otherwise invisible: names that sort into the order they ran, one
 * file per number, and statements that do not blow up on a second pass.
 *
 * None of that is enforced by anything else, and each one already slipped once.
 * See `drizzle/README.md` for the operating model and the outstanding debt.
 */

const DIR = join(process.cwd(), "drizzle");

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .toSorted();

const numberOf = (name: string) => name.slice(0, 4);

/**
 * Written in parallel on separate branches and merged without renumbering.
 * Each pair touches unrelated tables, so the unrecorded order within a pair has
 * never mattered — but a fourth collision is a new bug, not more of this one.
 */
const KNOWN_DUPLICATE_NUMBERS = ["0007", "0008", "0012"];

/**
 * Postgres has no `IF NOT EXISTS` for `ADD CONSTRAINT`, and these five predate
 * the `DO $$ … EXCEPTION WHEN duplicate_object` form that `0015` onwards uses.
 * They are already applied everywhere that matters; rewriting SQL that no test
 * here can execute is a worse trade than recording the debt and capping it.
 */
const GRANDFATHERED_BARE_CONSTRAINTS = [
  "0002_support_tickets.sql",
  "0004_booking_overlap.sql",
  "0006_event_tickets.sql",
  "0012_bookings_and_audience.sql",
  "0013_lifecycle_emails.sql",
];

/** `ADD CONSTRAINT`s left over once the guarded blocks are removed. */
function bareConstraintCount(sql: string): number {
  const unguarded = sql.replace(/DO \$\$[\s\S]*?END\s*\$\$;/g, " ");
  return (unguarded.match(/ADD\s+CONSTRAINT/gi) ?? []).length;
}

describe("migration filenames", () => {
  it("finds the directory", () => {
    // A rename that moved these would otherwise make every assertion below
    // pass over an empty list.
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s is NNNN_lower_snake_case.sql", (name) => {
    // Sort order is apply order, which only holds while the padding does.
    expect(name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it("numbers run from 0001 with no gaps", () => {
    const distinct = [...new Set(files.map(numberOf))].toSorted();
    const highest = Number(distinct.at(-1));
    const expected = Array.from({ length: highest }, (_, i) =>
      String(i + 1).padStart(4, "0"),
    );
    expect(distinct).toEqual(expected);
  });

  it("reuses no number beyond the three already merged", () => {
    const seen = new Map<string, number>();
    for (const name of files) {
      const n = numberOf(name);
      seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    const duplicated = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([n]) => n)
      .toSorted();

    expect(duplicated).toEqual(KNOWN_DUPLICATE_NUMBERS);
  });
});

describe("re-running a migration", () => {
  it.each(files)("%s guards its table, index and column creation", (name) => {
    /*
     * These all support `IF NOT EXISTS`, so there is no excuse for a bare one —
     * and a bare `CREATE TABLE` is what turns "replay the directory" into a
     * failure halfway through.
     */
    const sql = readFileSync(join(DIR, name), "utf8");
    const bare = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .filter((line) =>
        /^\s*(CREATE\s+(TABLE|(UNIQUE\s+)?INDEX|TYPE)|ALTER TABLE[\s\S]*ADD COLUMN)/i.test(line),
      )
      .filter((line) => !/IF NOT EXISTS/i.test(line));

    expect(bare).toEqual([]);
  });

  it("adds no new file with an unguarded constraint", () => {
    const offenders = files.filter((name) => {
      const sql = readFileSync(join(DIR, name), "utf8");
      return bareConstraintCount(sql) > 0;
    });

    expect(offenders).toEqual(GRANDFATHERED_BARE_CONSTRAINTS);
  });

  it("still has exactly the 13 bare constraints already accounted for", () => {
    // Pinned so the debt cannot quietly grow inside a file that is already on
    // the list — the count is what the README's table adds up to.
    const total = GRANDFATHERED_BARE_CONSTRAINTS.reduce(
      (sum, name) => sum + bareConstraintCount(readFileSync(join(DIR, name), "utf8")),
      0,
    );
    expect(total).toBe(13);
  });
});
