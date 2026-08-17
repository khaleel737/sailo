import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  clicks,
  visits,
} from "@sailo/db/schema";
import { inWindow, windowBounds } from "./bounds";
import type { Window } from "./bounds";

export async function getVisitBreakdown(
  shopId: string,
  window: Window = 30,
  limit = 6,
) {
  const db = getReadDb();
  const { since, until } = windowBounds(window);
  const scope = and(
    eq(visits.shopId, shopId),
    inWindow(visits.createdAt, since, until),
  );

  /** Grouped counts for one column, ignoring rows where it's null. */
  const top = async <T extends AnyPgColumn>(column: T) =>
    db
      .select({
        key: sql<string>`${column}`,
        count: sql<string>`count(*)`,
        unique: sql<string>`count(distinct ${visits.sessionId})`,
      })
      .from(visits)
      .where(and(scope, isNotNull(column)))
      .groupBy(sql`${column}`)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);

  const [countries, cities, sources, referrers, devices, campaigns, totals] =
    await Promise.all([
      top(visits.country),
      // A city name is only meaningful with its country — "Springfield" alone
      // could be any of dozens.
      db
        .select({
          key: sql<string>`${visits.city}`,
          country: sql<string>`max(${visits.country})`,
          count: sql<string>`count(*)`,
          unique: sql<string>`count(distinct ${visits.sessionId})`,
        })
        .from(visits)
        .where(and(scope, isNotNull(visits.city)))
        .groupBy(sql`${visits.city}`)
        .orderBy(desc(sql`count(*)`))
        .limit(limit),
      top(visits.source),
      top(visits.referrerHost),
      top(visits.device),
      db
        .select({
          key: sql<string>`coalesce(${visits.utmCampaign}, ${visits.utmSource})`,
          medium: sql<string>`max(${visits.utmMedium})`,
          source: sql<string>`max(${visits.utmSource})`,
          count: sql<string>`count(*)`,
          unique: sql<string>`count(distinct ${visits.sessionId})`,
        })
        .from(visits)
        .where(
          and(
            scope,
            or(isNotNull(visits.utmCampaign), isNotNull(visits.utmSource)),
          ),
        )
        .groupBy(sql`coalesce(${visits.utmCampaign}, ${visits.utmSource})`)
        .orderBy(desc(sql`count(*)`))
        .limit(limit),
      db
        .select({
          count: sql<string>`count(*)`,
          unique: sql<string>`count(distinct ${visits.sessionId})`,
          located: sql<string>`count(*) filter (where ${visits.country} is not null)`,
        })
        .from(visits)
        .where(scope),
    ]);

  const rows = <R extends { key: string; count: string; unique: string }>(
    list: R[],
  ) =>
    list.map((r) => ({
      ...r,
      count: Number(r.count),
      unique: Number(r.unique),
    }));

  return {
    total: Number(totals[0]?.count ?? 0),
    unique: Number(totals[0]?.unique ?? 0),
    /** Visits the edge could place. Zero in local development. */
    located: Number(totals[0]?.located ?? 0),
    countries: rows(countries),
    cities: rows(cities),
    sources: rows(sources),
    referrers: rows(referrers),
    devices: rows(devices),
    campaigns: rows(campaigns),
  };
}

export type VisitBreakdown = Awaited<ReturnType<typeof getVisitBreakdown>>;

/**
 * Where visitors went next — outbound click hosts, over the same window as
 * the sources panel it renders beside.
 *
 * Reads the raw `clicks` table for the whole window: clicks are an order of
 * magnitude rarer than visits and the table is not trimmed, so the read is
 * both cheap and complete. The nightly rollup still folds a `destinations`
 * dimension into `visit_daily` so the day this table ever needs a retention
 * window, the history is already somewhere the charts can reach.
 */
export async function getClickBreakdown(
  shopId: string,
  window: Window = 30,
  limit = 6,
) {
  const db = getReadDb();
  const { since, until } = windowBounds(window);
  const scope = and(
    eq(clicks.shopId, shopId),
    inWindow(clicks.createdAt, since, until),
  );

  const [hosts, totals] = await Promise.all([
    db
      .select({
        key: clicks.targetHost,
        count: sql<string>`count(*)`,
        unique: sql<string>`count(distinct ${clicks.sessionId})`,
      })
      .from(clicks)
      .where(scope)
      .groupBy(clicks.targetHost)
      .orderBy(desc(sql`count(*)`))
      .limit(limit),
    db
      .select({
        count: sql<string>`count(*)`,
        unique: sql<string>`count(distinct ${clicks.sessionId})`,
      })
      .from(clicks)
      .where(scope),
  ]);

  return {
    total: Number(totals[0]?.count ?? 0),
    unique: Number(totals[0]?.unique ?? 0),
    hosts: hosts.map((r) => ({
      key: r.key,
      count: Number(r.count),
      unique: Number(r.unique),
    })),
  };
}

export type ClickBreakdown = Awaited<ReturnType<typeof getClickBreakdown>>;

/** The table never renders more than a page of this at once. */
