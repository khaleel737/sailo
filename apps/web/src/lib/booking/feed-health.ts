import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { shops } from "@/db/schema";
import { fetchExternalBusy } from "./external-busy";

/**
 * Keeping the settings card honest about a calendar nobody has looked at.
 *
 * The read path deliberately writes nothing — it runs on a public booking
 * page and must not turn a page view into an UPDATE. So the one place that
 * knows a feed has stopped working would be a log line, and the seller's
 * first evidence would be a buyer arriving during their holiday.
 *
 * This runs on the hourly sweep instead: fetch, stamp the outcome, move on.
 * It never changes availability — a broken feed already hides nothing — it
 * only changes what the seller is told.
 */

/**
 * How many shops one pass will check.
 *
 * Each is an outbound request to somebody else's server, so an unbounded pass
 * is a cron job whose runtime is set by how many sellers signed up. Ordered
 * oldest-checked-first so the set rotates and no shop is starved; the count
 * of what was left is returned rather than dropped, because a ceiling nobody
 * is told about is a ceiling that lies.
 */
const PER_PASS = 200;

/** How stale a stamp has to be before it is worth another request. */
const STALE_MINUTES = 55;

export async function refreshCalendarFeeds(now = new Date()) {
  const db = getDb();
  const staleBefore = new Date(now.getTime() - STALE_MINUTES * 60_000);

  const due = await db
    .select({
      id: shops.id,
      timeZone: shops.timeZone,
      calendarFeedUrl: shops.calendarFeedUrl,
    })
    .from(shops)
    .where(
      sql`${shops.calendarFeedUrl} is not null
          and ${shops.deletedAt} is null
          and (${shops.calendarFeedCheckedAt} is null
               or ${shops.calendarFeedCheckedAt} < ${staleBefore})`,
    )
    .orderBy(asc(shops.calendarFeedCheckedAt))
    .limit(PER_PASS + 1);

  const clamped = due.length > PER_PASS;
  const batch = due.slice(0, PER_PASS);

  let broken = 0;

  for (const shop of batch) {
    if (!shop.calendarFeedUrl) continue;

    const result = await fetchExternalBusy({
      url: shop.calendarFeedUrl,
      timeZone: shop.timeZone,
      from: new Date(now.getTime() - 24 * 3_600_000),
      to: new Date(now.getTime() + 7 * 24 * 3_600_000),
    });

    if (!result.ok) broken += 1;

    await db
      .update(shops)
      .set({
        calendarFeedCheckedAt: new Date(),
        calendarFeedError: result.ok ? null : result.reason,
      })
      .where(eq(shops.id, shop.id));
  }

  if (clamped) {
    console.warn(
      `[sailo] calendar feed check stopped at ${PER_PASS} shops; more were due`,
    );
  }

  return { checked: batch.length, broken, clamped };
}
