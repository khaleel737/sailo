import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import {
  orders,
  visitDaily,
  visits,
} from "@sailo/db/schema";
import { inWindow, seriesWindow } from "./bounds";
import type { Window } from "./bounds";

export async function getVisitSeries(shopId: string, window: Window = 14) {
  const { since, until, keys } = seriesWindow(window);
  const db = getReadDb();

  /*
   * Read the rollup first, then today from the raw table.
   *
   * Yesterday and earlier are already folded into one row per day, so a chart
   * over a year reads 365 rows instead of a year of pageviews. Today isn't
   * folded yet — the fold runs overnight — so it still comes from raw, which
   * is a single day of one shop's rows and cheap. Any day the rollup is
   * missing falls through to raw as well, so a skipped night shows real
   * numbers rather than a hole.
   */
  const [rolled, raw] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char(${visitDaily.day}, 'YYYY-MM-DD')`,
        count: visitDaily.visits,
        unique: visitDaily.uniqueVisitors,
      })
      .from(visitDaily)
      .where(
        and(
          eq(visitDaily.shopId, shopId),
          inWindow(visitDaily.day, since, until),
        ),
      ),
    db
      .select({
        day: sql<string>`to_char(${visits.createdAt}::date, 'YYYY-MM-DD')`,
        count: sql<string>`count(*)`,
        unique: sql<string>`count(distinct ${visits.sessionId})`,
      })
      .from(visits)
      .where(
        and(eq(visits.shopId, shopId), inWindow(visits.createdAt, since, until)),
      )
      .groupBy(sql`${visits.createdAt}::date`),
  ]);

  const byDay = new Map(
    rolled.map((r) => [
      r.day,
      { count: Number(r.count), unique: Number(r.unique) },
    ]),
  );
  for (const r of raw) {
    // Raw wins only where the rollup hasn't been there — never added to it,
    // or a folded day whose raw rows are still inside retention doubles.
    if (!byDay.has(r.day)) {
      byDay.set(r.day, { count: Number(r.count), unique: Number(r.unique) });
    }
  }

  return keys.map((day) => ({
    day,
    count: byDay.get(day)?.count ?? 0,
    unique: byDay.get(day)?.unique ?? 0,
  }));
}

/**
 * Daily sales, refunds and the net of the two, zero-filled.
 *
 * Sales and refunds are counted on different days on purpose, because they
 * happen on different days. The previous version subtracted a refund from the
 * day the *order* was placed, so refunding a three-week-old order silently
 * rewrote a bar three weeks back and a seller watching the chart saw history
 * change. A refund is money leaving on the day it leaves.
 *
 * That also fixes an arithmetic fault the old shape hid. It subtracted every
 * refund while only adding non-cancelled sales, so an order that was cancelled
 * *and* refunded took its money out of a day that had never counted it in —
 * pushing the day negative for no reason a seller could see.
 */
export async function getRevenueSeries(shopId: string, window: Window = 14) {
  const { since, until, keys } = seriesWindow(window);
  const db = getReadDb();

  const [sales, refunds] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char(${orders.createdAt}::date, 'YYYY-MM-DD')`,
        cents: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      })
      .from(orders)
      .where(
        and(eq(orders.shopId, shopId), inWindow(orders.createdAt, since, until)),
      )
      .groupBy(sql`${orders.createdAt}::date`),
    db
      .select({
        day: sql<string>`to_char(${orders.refundedAt}::date, 'YYYY-MM-DD')`,
        cents: sql<string>`coalesce(sum(${orders.refundedCents}), 0)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.shopId, shopId),
          isNotNull(orders.refundedAt),
          inWindow(orders.refundedAt, since, until),
        ),
      )
      .groupBy(sql`${orders.refundedAt}::date`),
  ]);

  const salesByDay = new Map(sales.map((r) => [r.day, Number(r.cents)]));
  const refundsByDay = new Map(refunds.map((r) => [r.day, Number(r.cents)]));

  return keys.map((day) => {
    const gross = salesByDay.get(day) ?? 0;
    // Held positive — it is an amount refunded, not a negative sale. The chart
    // decides which side of the axis it belongs on.
    const refunded = refundsByDay.get(day) ?? 0;
    return {
      day,
      cents: gross - refunded,
      grossCents: gross,
      refundedCents: refunded,
    };
  });
}

/**
 * Where a shop's visitors come from, over the same window as the charts.
 *
 * One pass over the visits table per dimension. Each is `count(*)` grouped and
 * ordered, capped at a handful of rows — a seller acts on the top few and a
 * long tail of one-visit referrers is noise.
 */
