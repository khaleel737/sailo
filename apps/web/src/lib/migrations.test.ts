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
 * Numbers handed to a wave that has not landed yet.
 *
 * `docs/specs/agents/README.md` splits the 2026-08 release across six agents
 * and gives each a disjoint block of migration numbers, so six branches can
 * write SQL at once without any of them having to guess what the others took.
 * That is the whole point of the allocation — and it guarantees a gap the
 * moment the waves land out of order, which they do, because nothing sequences
 * them beyond E going last.
 *
 * So a gap is now two different facts. One is the bug this test was written
 * for: somebody wrote `0057` and forgot to `git add` `0056`, and the directory
 * silently stopped being replayable in order. The other is a wave still in
 * flight.
 *
 * Read from that table rather than copied into a list here, so the two cannot
 * drift and nobody has to remember to prune this as waves land. An unreserved
 * gap still fails, which is the case worth failing on.
 */
function reservedNumbers(): Set<string> {
  const table = readFileSync(
    join(process.cwd(), "../../docs/specs/agents/README.md"),
    "utf8",
  );
  const out = new Set<string>();
  // `| wave-a-reach.md | … | 0036–0038 |` — an en dash in the source.
  for (const [, from, to] of table.matchAll(/\|\s*(\d{4})\s*[–-]\s*(\d{4})\s*\|/g)) {
    for (let n = Number(from); n <= Number(to); n++) {
      out.add(String(n).padStart(4, "0"));
    }
  }
  return out;
}

/**
 * Postgres has no `IF NOT EXISTS` for `ADD CONSTRAINT`, and these five predate
 * the `DO $$ … EXCEPTION WHEN duplicate_object` form that `0015` onwards uses.
 * They are already applied everywhere that matters; rewriting SQL that no test
 * here can execute is a worse trade than recording the debt and capping it.
 */
const GRANDFATHERED_BARE_CONSTRAINTS = [
  /*
   * `0002_support_tickets.sql` used to be on this list and should not have
   * been. Its constraint is guarded — by an `IF NOT EXISTS (SELECT … FROM
   * pg_catalog)` inside a `DO` block rather than by `EXCEPTION WHEN
   * duplicate_object`, which is the older of the two safe forms and arguably
   * the clearer one. What put it here was the *comment* above it, which
   * contains the words `ADD CONSTRAINT` while explaining why the guard is
   * needed. The counter now strips comments, so the file reads as what it is.
   */
  "0004_booking_overlap.sql",
  "0006_event_tickets.sql",
  "0012_bookings_and_audience.sql",
  "0013_lifecycle_emails.sql",
];

/** `ADD CONSTRAINT`s left over once the guarded blocks are removed. */
function bareConstraintCount(sql: string): number {
  /*
   * Comments first, then guarded blocks.
   *
   * A `--` line that *describes* an unguarded constraint is not one, and 0046
   * was failing this check for a sentence explaining why it re-creates the
   * booking exclusion constraint. Counting prose as SQL sends the next author
   * hunting for a statement that is not there — and the obvious workaround,
   * rewording the comment, makes the file worse to read in order to satisfy a
   * regex.
   */
  const withoutComments = sql.replace(/--[^\n]*/g, " ");
  const unguarded = withoutComments.replace(/DO \$\$[\s\S]*?END\s*\$\$;/g, " ");
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

  it("numbers run from 0001, gapped only where a wave is still out", () => {
    const claimed = new Set(files.map(numberOf));
    const highest = Number([...claimed].toSorted().at(-1));
    const reserved = reservedNumbers();

    const unexplained = Array.from({ length: highest }, (_, i) =>
      String(i + 1).padStart(4, "0"),
    ).filter((n) => !claimed.has(n) && !reserved.has(n));

    expect(unexplained).toEqual([]);
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

  it("finds the wave table it reads reservations from", () => {
    // A moved or reformatted table would make the check above vacuous — every
    // gap unreserved is loud, but every gap *reserved* is silent, and an empty
    // set is what a failed parse produces.
    expect(reservedNumbers().size).toBeGreaterThan(20);
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

  it("still has exactly the 12 bare constraints already accounted for", () => {
    // Pinned so the debt cannot quietly grow inside a file that is already on
    // the list — the count is what the README's table adds up to.
    const total = GRANDFATHERED_BARE_CONSTRAINTS.reduce(
      (sum, name) => sum + bareConstraintCount(readFileSync(join(DIR, name), "utf8")),
      0,
    );
    expect(total).toBe(12);
  });
});
