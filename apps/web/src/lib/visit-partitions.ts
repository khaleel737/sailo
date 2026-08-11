import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@sailo/db";

/**
 * Monthly partitions for `visits`, and the retention that drops them.
 *
 * WHY THE TABLE IS PARTITIONED
 * Not theory — measured. Before this, `visits` held 1,530 rows in 352kB of
 * heap and **78MB of indexes**. Postgres had seen three million deletes on it,
 * because retention was a `DELETE` running every night. Autovacuum reclaims the
 * heap and leaves the B-trees: index pages are marked reusable, never returned,
 * so a table that is repeatedly emptied and refilled grows indexes that only
 * ever get bigger. At ten thousand shops that is the busiest table in the product
 * quietly becoming its largest.
 *
 * A partition drop takes the data and its indexes together, in one catalogue
 * operation, with nothing left to vacuum. Retention stops being a write.
 *
 * WHERE THE PARTITIONS LIVE
 * In their own `visits_parts` schema, deliberately. This repo manages its
 * schema with `npm run db:push`, which diffs the database against
 * `src/db/schema` and offers to drop whatever it does not recognise. Twelve
 * monthly children sitting in `public` are twelve tables it has never heard of.
 * Out of `public`, they are out of its way.
 */

/** The first day of the month `offset` months from `from`, in UTC. */
function monthStart(from: Date, offset = 0): Date {
  return new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1),
  );
}

/** `visits_2026_08` — sorts chronologically, reads unambiguously. */
export function partitionName(month: Date): string {
  const year = month.getUTCFullYear();
  const mon = String(month.getUTCMonth() + 1).padStart(2, "0");
  return `visits_${year}_${mon}`;
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Reads a Postgres partition bound as the UTC instant it is.
 *
 * `created_at` is `timestamp without time zone` holding UTC wall-clock, which
 * is how the rest of this codebase treats time. `pg_get_expr` hands the bound
 * back as `2026-07-01 00:00:00`, and `new Date` of that reads it in the
 * machine's zone — on a box at UTC+2 every partition appeared to begin two
 * hours early, which is enough to drop a month before its data has aged out.
 */
export function asUtc(bound: string): Date {
  return new Date(`${bound.trim().replace(" ", "T")}Z`);
}

/**
 * Creates the partition for a month if it is not already there.
 *
 * `IF NOT EXISTS` rather than a catalogue lookup first: two runs racing on the
 * same month is a normal thing for a cron that can be retried, and the database
 * settles it better than we can.
 */
export async function ensurePartition(month: Date): Promise<string> {
  const start = monthStart(month);
  const end = monthStart(month, 1);
  const name = partitionName(start);

  /*
   * `sql.raw`, not interpolation. A partition bound has to be a literal in the
   * statement text — passed as a bind parameter, Postgres rejects the whole
   * thing with a protocol violation before it ever looks at the dates. Both
   * values here are formatted from a `Date` and the name is built from its
   * year and month, so there is nothing in the string a request could reach.
   */
  await getDb().execute(
    sql.raw(
      `create table if not exists visits_parts."${name}" ` +
        `partition of public.visits ` +
        `for values from ('${isoDay(start)}') to ('${isoDay(end)}')`,
    ),
  );
  return name;
}

/**
 * Makes sure this month and the next few exist.
 *
 * A row that matches no partition is rejected outright — an insert into a
 * partitioned table with no home for its timestamp raises, it does not fall
 * back to the parent. So the months are created *ahead* of need, and several of
 * them: one month of runway means a single missed cron drops every pageview at
 * midnight on the first.
 */
export async function ensureUpcomingPartitions(
  now: Date = new Date(),
  monthsAhead = 3,
): Promise<string[]> {
  const created: string[] = [];
  for (let offset = 0; offset <= monthsAhead; offset++) {
    created.push(await ensurePartition(monthStart(now, offset)));
  }
  return created;
}

/** A partition, and the window it holds. */
export type Partition = { name: string; from: Date; to: Date };

/** Every partition currently attached, oldest first. */
export async function listPartitions(): Promise<Partition[]> {
  const rows = await getDb().execute<{ name: string; bounds: string }>(
    sql`select c.relname as name,
               pg_get_expr(c.relpartbound, c.oid) as bounds
        from pg_class c
        join pg_inherits i on i.inhrelid = c.oid
        where i.inhparent = 'public.visits'::regclass
        order by c.relname`,
  );

  const parsed: Partition[] = [];
  for (const row of rows.rows ?? []) {
    // `FOR VALUES FROM ('2026-07-01 00:00:00') TO ('2026-08-01 00:00:00')`
    const match = /FROM \('([^']+)'\) TO \('([^']+)'\)/.exec(row.bounds);
    if (!match?.[1] || !match[2]) continue;
    parsed.push({
      name: row.name,
      from: asUtc(match[1]),
      to: asUtc(match[2]),
    });
  }
  return parsed;
}

/**
 * Which partitions are entirely outside the retention window.
 *
 * Whole months only. A partition still holding one in-window row is left alone
 * and its stragglers are trimmed by the row-wise path — dropping it would take
 * data the retention window still promises.
 */
export function expiredPartitions(
  partitions: readonly Partition[],
  cutoff: Date,
): Partition[] {
  /*
   * `to` is exclusive, so a partition is spent only once its end has been
   * reached — `>=`, not `>`. Using `>` would drop the month the cutoff lands
   * exactly on, taking a day of data the retention window still promises.
   */
  return partitions.filter((partition) => cutoff >= partition.to);
}

export async function dropExpiredPartitions(cutoff: Date): Promise<string[]> {
  const dropped: string[] = [];

  for (const partition of expiredPartitions(await listPartitions(), cutoff)) {
    await getDb().execute(
      sql.raw(`drop table if exists visits_parts."${partition.name}"`),
    );
    dropped.push(partition.name);
  }
  return dropped;
}

/** True when `visits` is partitioned, so callers can keep working if it isn't. */
export async function isPartitioned(): Promise<boolean> {
  const rows = await getDb().execute<{ relkind: string }>(
    sql`select relkind from pg_class where oid = 'public.visits'::regclass`,
  );
  return rows.rows?.[0]?.relkind === "p";
}
