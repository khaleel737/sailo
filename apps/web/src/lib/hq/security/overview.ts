/**
 * The headline figures, and sign-ins over time.
 *
 * What HQ opens the page for: how many accounts, how many paying, how much is at risk, and
 * whether sign-ins look normal.
 */

import "server-only";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  apiKeys,
  session as sessionTable,
  shops,
  twoFactor,
  user,
  webhookEndpoints,
} from "@sailo/db/schema";
import { requireStaff } from "@/lib/session";
import { daysAgo, num, utcDayWindow } from "../pagination";
import { notStaff } from "../roster";
import { PAID, live } from "./paid";

/* -------------------------------------------------------------------------- */
/*  The platform's security posture, in numbers                                */
/* -------------------------------------------------------------------------- */

/** Everything the security page's tiles are made of. */
export async function getSecurityOverview() {
  await requireStaff();
  const db = getDb();

  const day = daysAgo(1);
  const week = daysAgo(7);
  const quarter = daysAgo(90);

  const [
    [accounts],
    [sessions],
    countries,
    [exposure],
    [enrolment],
    [keys],
    [hooks],
  ] = await Promise.all([
    // Customers only, like every other account figure in HQ — counting our own
    // staff row would flatter 2FA adoption by exactly one.
    db
      .select({
        total: sql<string>`count(*)`,
        twoFactor: sql<string>`count(*) filter (where ${user.twoFactorEnabled})`,
        unverified: sql<string>`count(*) filter (where not ${user.emailVerified})`,
        newWeek: sql<string>`count(*) filter (where ${user.createdAt} >= ${week})`,
      })
      .from(user)
      .where(notStaff()),

    /*
     * Sessions are counted for *everyone*, staff included. Every other list in
     * HQ excludes us because we are not a customer; here we are as much of an
     * attack surface as any seller — more, since our sessions open this panel —
     * and a security page that hides its own operators' devices is decoration.
     * The table marks them, rather than dropping them.
     */
    db
      .select({
        live: sql<string>`count(*)`,
        accounts: sql<string>`count(distinct ${sessionTable.userId})`,
        day: sql<string>`count(*) filter (where ${sessionTable.createdAt} >= ${day})`,
        week: sql<string>`count(*) filter (where ${sessionTable.createdAt} >= ${week})`,
        // `updatedAt` is refreshed at most once a day (`updateAge` in
        // lib/auth.ts), so this is "used since yesterday", not "online now".
        seenDay: sql<string>`count(*) filter (where ${sessionTable.updatedAt} >= ${day})`,
        located: sql<string>`count(*) filter (where ${sessionTable.country} is not null)`,
      })
      .from(sessionTable)
      .where(live()),

    db
      .select({
        country: sessionTable.country,
        sessions: sql<string>`count(*)`,
        accounts: sql<string>`count(distinct ${sessionTable.userId})`,
      })
      .from(sessionTable)
      .where(and(live(), isNotNull(sessionTable.country)))
      .groupBy(sessionTable.country)
      .orderBy(desc(sql`count(*)`))
      .limit(10),

    // What an account compromise would actually cost — a shop taking cards, or
    // one we bill, is worth more to steal than an empty one.
    db
      .select({
        shops: sql<string>`count(*)`,
        takingCards: sql<string>`count(*) filter (where ${shops.stripeChargesEnabled})`,
        cardsNoTwoFactor: sql<string>`count(*) filter (where ${shops.stripeChargesEnabled} and not ${user.twoFactorEnabled})`,
        paidNoTwoFactor: sql<string>`count(*) filter (where ${PAID} and not ${user.twoFactorEnabled})`,
        liveUnverified: sql<string>`count(*) filter (where ${shops.isPublished} and not ${user.emailVerified})`,
      })
      .from(shops)
      .innerJoin(user, eq(user.id, shops.userId))
      /*
       * Customers only — and here that is not tidiness, it is the difference
       * between a banner and a wild goose chase. Our own shop is a shop like
       * any other, so without this it can be the "1 shop takes cards with no
       * second factor" the page shouts about, while the watchlist below it —
       * which does exclude us — sits empty.
       */
      .where(notStaff()),

    /*
     * The 2FA plugin's own lockout counters. A row with a non-zero failure
     * count is somebody typing codes that don't work — themselves on a phone
     * with a drifted clock, or someone else with their password.
     */
    db
      .select({
        enrolled: sql<string>`count(*)`,
        verified: sql<string>`count(*) filter (where ${twoFactor.verified})`,
        locked: sql<string>`count(*) filter (where ${twoFactor.lockedUntil} > now())`,
        failing: sql<string>`count(*) filter (where ${twoFactor.failedVerificationCount} > 0)`,
      })
      .from(twoFactor)
      // Same reason as the exposure counts: these drive a banner that links to
      // a list we are not in.
      .innerJoin(user, eq(user.id, twoFactor.userId))
      .where(notStaff()),

    db
      .select({
        total: sql<string>`count(*)`,
        live: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is null)`,
        revoked: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is not null)`,
        usedWeek: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is null and ${apiKeys.lastUsedAt} >= ${week})`,
        // Live, and either never used or not used this quarter. A key nobody
        // is using is a credential with no upside left, only downside.
        dormant: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is null and (${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < ${quarter}))`,
        writable: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is null and 'write' = any(${apiKeys.scopes}))`,
      })
      .from(apiKeys),

    db
      .select({
        total: sql<string>`count(*)`,
        active: sql<string>`count(*) filter (where ${webhookEndpoints.isActive})`,
        disabled: sql<string>`count(*) filter (where not ${webhookEndpoints.isActive})`,
        failing: sql<string>`count(*) filter (where ${webhookEndpoints.isActive} and ${webhookEndpoints.failureCount} > 0)`,
      })
      .from(webhookEndpoints),
  ]);

  return {
    accounts: {
      total: num(accounts?.total),
      twoFactor: num(accounts?.twoFactor),
      unverified: num(accounts?.unverified),
      newWeek: num(accounts?.newWeek),
    },
    sessions: {
      live: num(sessions?.live),
      accounts: num(sessions?.accounts),
      day: num(sessions?.day),
      week: num(sessions?.week),
      seenDay: num(sessions?.seenDay),
      located: num(sessions?.located),
    },
    countries: countries.map((row) => ({
      country: row.country,
      sessions: num(row.sessions),
      accounts: num(row.accounts),
    })),
    exposure: {
      shops: num(exposure?.shops),
      takingCards: num(exposure?.takingCards),
      cardsNoTwoFactor: num(exposure?.cardsNoTwoFactor),
      paidNoTwoFactor: num(exposure?.paidNoTwoFactor),
      liveUnverified: num(exposure?.liveUnverified),
    },
    twoFactor: {
      enrolled: num(enrolment?.enrolled),
      verified: num(enrolment?.verified),
      locked: num(enrolment?.locked),
      failing: num(enrolment?.failing),
    },
    keys: {
      total: num(keys?.total),
      live: num(keys?.live),
      revoked: num(keys?.revoked),
      usedWeek: num(keys?.usedWeek),
      dormant: num(keys?.dormant),
      writable: num(keys?.writable),
    },
    webhooks: {
      total: num(hooks?.total),
      active: num(hooks?.active),
      disabled: num(hooks?.disabled),
      failing: num(hooks?.failing),
    },
  };
}

/**
 * Sessions started per day.
 *
 * Deliberately short: sessions expire after 30 days and the row goes with them,
 * so a 30-day chart drawn from this table slopes to nothing at the left-hand
 * end and looks like a collapse in sign-ins that never happened. Two weeks is
 * inside the window everywhere, so every bucket is complete.
 */
export async function getSignInSeries(days = 14) {
  await requireStaff();
  const { since, keys } = utcDayWindow(days);

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${sessionTable.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<string>`count(*)`,
    })
    .from(sessionTable)
    .where(gte(sessionTable.createdAt, since))
    .groupBy(sql`${sessionTable.createdAt}::date`);

  const byDay = new Map(rows.map((r) => [r.day, num(r.count)]));
  return keys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}
