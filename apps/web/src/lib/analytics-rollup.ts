import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@sailo/db";
import {
  affiliates,
  clicks,
  visitDaily,
  visits,
  type VisitBreakdownJson,
} from "@sailo/db/schema";
import { publishAffiliateEvent, publishShopEvent } from "@sailo/events";
import { drainAffiliateClicks } from "@sailo/rate-limit";
import {
  dropExpiredPartitions,
  ensureUpcomingPartitions,
  isPartitioned,
} from "@/lib/visit-partitions";

/**
 * Folding raw visits into daily rows.
 *
 * The arithmetic that matters: a shop taking a hundred views a day writes
 * 3,000 rows a month. Ten thousand shops write 30 million, and the only thing
 * anyone ever asks of them is "how many, per day, for the last month". Kept
 * raw, that question re-reads thirty million rows to draw thirty bars.
 *
 * So each night the previous days are folded into one row per shop per day,
 * and raw rows past the retention window are dropped. The charts read the
 * rollup; the raw table stays small enough to stay fast.
 *
 * Idempotent by (shop, day): re-running for a day overwrites it rather than
 * doubling it, so a failed run is fixed by running again.
 */

/** How long raw rows are kept. Long enough to re-derive a bad rollup. */
export const RAW_RETENTION_DAYS = 90;

/** Only the head of each dimension is kept — a long tail of one-offs is noise. */
const TOP_N = 10;

function utcDay(date: Date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function dimension(
  shopId: string,
  from: Date,
  to: Date,
  column: PgColumn,
): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ key: column, n: sql<string>`count(*)` })
    .from(visits)
    .where(
      and(
        eq(visits.shopId, shopId),
        gte(visits.createdAt, from),
        lt(visits.createdAt, to),
        isNotNull(column),
      ),
    )
    .groupBy(column)
    .orderBy(desc(sql`count(*)`))
    .limit(TOP_N);

  const out: Record<string, number> = {};
  for (const row of rows) {
    // Both null and undefined, deliberately: a grouped column comes back
    // null when the visit had no value for it, and skipping those is what
    // keeps "unknown" out of the top-N as if it were a real answer.
    if (row.key !== null && row.key !== undefined) {
      out[String(row.key)] = Number(row.n);
    }
  }
  return out;
}

/**
 * Where the day's visitors went next — outbound click hosts, from `clicks`
 * rather than `visits`, folded into the same breakdown row.
 *
 * A day with clicks but no visits never reaches this (the rollup selects
 * active shops by visits, and a click implies the pageview that carried the
 * link), and the raw `clicks` table is not trimmed — so a missing fold loses
 * nothing that cannot be re-derived.
 */
async function clickDimension(
  shopId: string,
  from: Date,
  to: Date,
): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ key: clicks.targetHost, n: sql<string>`count(*)` })
    .from(clicks)
    .where(
      and(
        eq(clicks.shopId, shopId),
        gte(clicks.createdAt, from),
        lt(clicks.createdAt, to),
      ),
    )
    .groupBy(clicks.targetHost)
    .orderBy(desc(sql`count(*)`))
    .limit(TOP_N);

  const out: Record<string, number> = {};
  for (const row of rows) out[row.key] = Number(row.n);
  return out;
}

/** Folds one shop's one day. Returns null when that day had no traffic. */
export async function rollUpDay(shopId: string, day: Date) {
  const db = getDb();
  const from = utcDay(day);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

  const [totals] = await db
    .select({
      visits: sql<string>`count(*)`,
      uniques: sql<string>`count(distinct ${visits.sessionId})`,
    })
    .from(visits)
    .where(
      and(
        eq(visits.shopId, shopId),
        gte(visits.createdAt, from),
        lt(visits.createdAt, to),
      ),
    );

  const count = Number(totals?.visits ?? 0);
  if (count === 0) return null;

  const [countries, cities, sources, devices, referrers, destinations] =
    await Promise.all([
      dimension(shopId, from, to, visits.country),
      dimension(shopId, from, to, visits.city),
      dimension(shopId, from, to, visits.source),
      dimension(shopId, from, to, visits.device),
      dimension(shopId, from, to, visits.referrerHost),
      clickDimension(shopId, from, to),
    ]);

  const breakdown: VisitBreakdownJson = {
    countries,
    cities,
    sources,
    devices,
    referrers,
    destinations,
  };

  await db
    .insert(visitDaily)
    .values({
      shopId,
      day: from,
      visits: count,
      uniqueVisitors: Number(totals?.uniques ?? 0),
      breakdown,
    })
    // Re-running a day replaces it. Adding would double a retried night.
    .onConflictDoUpdate({
      target: [visitDaily.shopId, visitDaily.day],
      set: {
        visits: count,
        uniqueVisitors: Number(totals?.uniques ?? 0),
        breakdown,
      },
    });

  return { visits: count, uniques: Number(totals?.uniques ?? 0) };
}

/** How many raw rows one DELETE may take. */
const TRIM_BATCH = 5_000;
/** Ceiling on batches per run, so a backlog can't run the job forever. */
const TRIM_MAX_BATCHES = 200;

/**
 * Drops raw visits past the cutoff, a batch at a time.
 *
 * The fallback path now. Where `visits` is partitioned, whole months are
 * dropped instead and this only clears the stragglers inside the month the
 * cutoff runs through — plus any database where the migration has not run.
 *
 * Two reasons it isn't one statement. The count used to come from
 * `.returning({ id })`, which streams every deleted uuid back over an HTTP
 * driver purely to call `.length` on it — at the volumes described above that
 * is millions of ids marshalled to produce one number, and the function runs
 * out of memory before it prints it. And a single unbounded DELETE holds one
 * long transaction over the busiest table in the product, which on a serverless
 * Postgres is how a nightly job turns into a nightly outage.
 *
 * Batching fixes both: each statement returns at most `TRIM_BATCH` ids and
 * commits on its own. Whatever the ceiling leaves behind is caught tomorrow —
 * the cutoff is a moving window, not a one-off migration.
 */
async function trimRawVisits(cutoff: Date): Promise<number> {
  const db = getDb();
  let removed = 0;

  for (let batch = 0; batch < TRIM_MAX_BATCHES; batch++) {
    const deleted = await db
      .delete(visits)
      .where(
        inArray(
          visits.id,
          db
            .select({ id: visits.id })
            .from(visits)
            .where(lt(visits.createdAt, cutoff))
            .limit(TRIM_BATCH),
        ),
      )
      .returning({ id: visits.id });

    removed += deleted.length;
    // A short batch means the tail is reached; anything else is another lap.
    if (deleted.length < TRIM_BATCH) break;
  }

  return removed;
}

/**
 * Rolls up every shop that had traffic in the window, then trims raw rows past
 * retention. Returns what it did, so the cron route can log something useful.
 */
export async function rollUpVisits(opts: { days?: number; now?: Date } = {}) {
  const db = getDb();
  const days = opts.days ?? 2; // yesterday and the day before, in case one was missed
  const now = opts.now ?? new Date();

  let shopsRolled = 0;
  let daysRolled = 0;

  for (let back = 1; back <= days; back++) {
    const day = utcDay(new Date(now.getTime() - back * 24 * 60 * 60 * 1000));
    const to = new Date(day.getTime() + 24 * 60 * 60 * 1000);

    // Only shops with traffic that day — most shops on most days have none.
    const active = await db
      .selectDistinct({ shopId: visits.shopId })
      .from(visits)
      .where(and(gte(visits.createdAt, day), lt(visits.createdAt, to)));

    for (const { shopId } of active) {
      const result = await rollUpDay(shopId, day);
      if (result) shopsRolled += 1;
    }
    daysRolled += 1;
  }

  const cutoff = new Date(
    now.getTime() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  /*
   * Retention, and the runway that keeps writes possible.
   *
   * A partitioned `visits` gives back a whole month in one catalogue
   * operation — data and indexes together, nothing left to vacuum. That is the
   * entire reason it is partitioned: as a plain table, three million deletes
   * had left 78MB of indexes standing over 352kB of rows.
   *
   * Creating the months ahead matters more than dropping the old ones. A row
   * whose timestamp finds no partition is rejected outright, so the day this
   * job stops running is the day pageviews start failing. Four months of
   * runway makes that four missed nights rather than one.
   */
  const partitioned = await isPartitioned();
  const partitionsAdded = partitioned
    ? await ensureUpcomingPartitions(now)
    : [];
  const partitionsDropped = partitioned
    ? await dropExpiredPartitions(cutoff)
    : [];
  const rawTrimmed = await trimRawVisits(cutoff);

  // Clicks buffered in Redis since the last run. Empty when Redis isn't
  // configured, in which case they were written straight to Postgres already.
  const buffered = await drainAffiliateClicks();
  let clicksFlushed = 0;
  for (const [affiliateId, count] of Object.entries(buffered)) {
    await db
      .update(affiliates)
      .set({ clicks: sql`${affiliates.clicks} + ${count}` })
      .where(eq(affiliates.id, affiliateId));
    clicksFlushed += count;
  }

  /*
   * The flush is the moment buffered clicks become visible rows, so it is
   * also the moment to tell the screens that count them: each affiliate's
   * portal, and the affiliates page of each shop those affiliates promote.
   * One lookup for the shop ids; per-shop dedup keeps a popular shop's
   * thirty affiliates from becoming thirty hints.
   */
  const flushedIds = Object.keys(buffered);
  if (flushedIds.length > 0) {
    const owners = await db.query.affiliates.findMany({
      where: inArray(affiliates.id, flushedIds),
      columns: { id: true, shopId: true },
    });
    for (const owner of owners) {
      await publishAffiliateEvent(owner.id, "affiliate");
    }
    for (const shopId of new Set(owners.map((owner) => owner.shopId))) {
      await publishShopEvent(shopId, "affiliate");
    }
  }

  return {
    daysRolled,
    shopsRolled,
    rawTrimmed,
    clicksFlushed,
    partitionsAdded,
    partitionsDropped,
  };
}
