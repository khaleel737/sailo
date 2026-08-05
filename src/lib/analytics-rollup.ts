import "server-only";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { affiliates, visitDaily, visits, type VisitBreakdownJson } from "@/db/schema";
import { drainAffiliateClicks } from "@/lib/redis";

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
    if (row.key != null) out[String(row.key)] = Number(row.n);
  }
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

  const [countries, cities, sources, devices, referrers] = await Promise.all([
    dimension(shopId, from, to, visits.country),
    dimension(shopId, from, to, visits.city),
    dimension(shopId, from, to, visits.source),
    dimension(shopId, from, to, visits.device),
    dimension(shopId, from, to, visits.referrerHost),
  ]);

  const breakdown: VisitBreakdownJson = {
    countries,
    cities,
    sources,
    devices,
    referrers,
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

  const cutoff = new Date(now.getTime() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const trimmed = await db
    .delete(visits)
    .where(lt(visits.createdAt, cutoff))
    .returning({ id: visits.id });

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

  return { daysRolled, shopsRolled, rawTrimmed: trimmed.length, clicksFlushed };
}
