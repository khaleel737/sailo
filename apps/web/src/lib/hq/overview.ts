import "server-only";
import { requireStaff } from "@/lib/session";
import { and, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, getReadDb } from "@sailo/db";
import { clients, orders, products, shops, user, visits } from "@sailo/db/schema";
import { mergeCurrencyTotals, rollUpRevenue } from "@/lib/hq-metrics";
import type { BillingGroup, CurrencyTotal } from "@/lib/hq-metrics";
import { ENTITLED } from "./billing-state";
import { daysAgo, num, utcDayWindow } from "./pagination";
import { notStaff } from "./roster";

/**
 * The platform at a glance: revenue, activation, growth.
 *
 * Reads the replica, which `db/index.ts` describes as exactly what it is for.
 * These are full-table counts over `orders`, `visits` and `clients` — the
 * three biggest tables — and they ran on the primary, which is the connection
 * every checkout needs to stay fast. Two staff members loading a dashboard
 * should not compete with a buyer paying.
 *
 * Safe on a replica because nothing here decides a write. A staff member who
 * suspends a shop or comps a plan does so through `actions/hq.ts`, which
 * re-reads the shop on the primary under `requireStaff` before it writes — so
 * a dashboard a few hundred milliseconds behind changes what is displayed, and
 * never what happens.
 */
export async function getPlatformOverview() {
  await requireStaff();
  const db = getReadDb();

  const day = daysAgo(1);
  const week = daysAgo(7);
  const twoWeeks = daysAgo(14);
  const month = daysAgo(30);
  const twoMonths = daysAgo(60);

  const [
    [signups],
    [shopCounts],
    [orderCounts],
    gmvRows,
    gmvMonthRows,
    billingGroups,
    [catalogue],
    [audience],
    [traffic],
  ] = await Promise.all([
    // Registrations, with the previous window alongside so the tiles can say
    // whether the number is going anywhere. Customers only — counting our own
    // staff account as a signup would flatter every one of these tiles by one.
    db
      .select({
        total: sql<string>`count(*)`,
        day: sql<string>`count(*) filter (where ${user.createdAt} >= ${day})`,
        week: sql<string>`count(*) filter (where ${user.createdAt} >= ${week})`,
        month: sql<string>`count(*) filter (where ${user.createdAt} >= ${month})`,
        prevWeek: sql<string>`count(*) filter (where ${user.createdAt} >= ${twoWeeks} and ${user.createdAt} < ${week})`,
        prevMonth: sql<string>`count(*) filter (where ${user.createdAt} >= ${twoMonths} and ${user.createdAt} < ${month})`,
      })
      .from(user)
      .where(notStaff()),

    db
      .select({
        total: sql<string>`count(*)`,
        live: sql<string>`count(*) filter (where ${shops.isPublished} and ${shops.suspendedAt} is null)`,
        unpublished: sql<string>`count(*) filter (where not ${shops.isPublished})`,
        suspended: sql<string>`count(*) filter (where ${shops.suspendedAt} is not null)`,
        newWeek: sql<string>`count(*) filter (where ${shops.createdAt} >= ${week})`,
        newMonth: sql<string>`count(*) filter (where ${shops.createdAt} >= ${month})`,
        connected: sql<string>`count(*) filter (where ${shops.stripeChargesEnabled})`,
        connectStarted: sql<string>`count(*) filter (where ${shops.stripeAccountId} is not null)`,
        affiliateShops: sql<string>`count(*) filter (where ${shops.affiliatesEnabled})`,
      })
      .from(shops),

    db
      .select({
        total: sql<string>`count(*)`,
        week: sql<string>`count(*) filter (where ${orders.createdAt} >= ${week})`,
        month: sql<string>`count(*) filter (where ${orders.createdAt} >= ${month})`,
        prevMonth: sql<string>`count(*) filter (where ${orders.createdAt} >= ${twoMonths} and ${orders.createdAt} < ${month})`,
        paid: sql<string>`count(*) filter (where ${orders.paymentStatus} = 'paid')`,
        awaiting: sql<string>`count(*) filter (where ${orders.status} = 'new')`,
        refunded: sql<string>`count(*) filter (where ${orders.refundedCents} > 0)`,
      })
      .from(orders),

    // Sellers price in their own currency, so volume is a list, not a number.
    db
      .select({
        currency: orders.currency,
        cents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      })
      .from(orders)
      .groupBy(orders.currency),

    db
      .select({
        currency: orders.currency,
        cents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      })
      .from(orders)
      .where(gte(orders.createdAt, month))
      .groupBy(orders.currency),

    /*
     * Subscriptions folded down to their distinct shapes. A dozen groups come
     * back whether the platform has five shops or fifty thousand, and
     * `rollUpRevenue` multiplies each by its count.
     */
    db
      .select({
        plan: shops.plan,
        subscriptionStatus: shops.subscriptionStatus,
        subscriptionInterval: shops.subscriptionInterval,
        compPlan: shops.compPlan,
        accounts: sql<string>`count(*)`,
      })
      .from(shops)
      .groupBy(
        shops.plan,
        shops.subscriptionStatus,
        shops.subscriptionInterval,
        shops.compPlan,
      ),

    db
      .select({
        products: sql<string>`count(*)`,
        published: sql<string>`count(*) filter (where ${products.isPublished})`,
        digital: sql<string>`count(*) filter (where ${products.kind} = 'digital')`,
        services: sql<string>`count(*) filter (where ${products.kind} = 'service')`,
      })
      .from(products),

    db
      .select({
        buyers: sql<string>`count(*)`,
        newMonth: sql<string>`count(*) filter (where ${clients.createdAt} >= ${month})`,
      })
      .from(clients),

    db
      .select({
        month: sql<string>`count(*) filter (where ${visits.createdAt} >= ${month})`,
        week: sql<string>`count(*) filter (where ${visits.createdAt} >= ${week})`,
      })
      .from(visits),
  ]);

  const revenue = rollUpRevenue(
    billingGroups.map(
      (row): BillingGroup => ({
        plan: row.plan,
        subscriptionStatus: row.subscriptionStatus,
        subscriptionInterval: row.subscriptionInterval,
        compPlan: row.compPlan,
        accounts: num(row.accounts),
      }),
    ),
  );

  const toTotals = (rows: { currency: string; cents: string }[]) =>
    mergeCurrencyTotals(
      rows.map((r): CurrencyTotal => ({ currency: r.currency, cents: num(r.cents) })),
    );

  return {
    revenue,
    accounts: {
      total: num(signups?.total),
      day: num(signups?.day),
      week: num(signups?.week),
      month: num(signups?.month),
      prevWeek: num(signups?.prevWeek),
      prevMonth: num(signups?.prevMonth),
    },
    shops: {
      total: num(shopCounts?.total),
      live: num(shopCounts?.live),
      unpublished: num(shopCounts?.unpublished),
      suspended: num(shopCounts?.suspended),
      newWeek: num(shopCounts?.newWeek),
      newMonth: num(shopCounts?.newMonth),
      connected: num(shopCounts?.connected),
      connectStarted: num(shopCounts?.connectStarted),
      affiliateShops: num(shopCounts?.affiliateShops),
    },
    orders: {
      total: num(orderCounts?.total),
      week: num(orderCounts?.week),
      month: num(orderCounts?.month),
      prevMonth: num(orderCounts?.prevMonth),
      paid: num(orderCounts?.paid),
      awaiting: num(orderCounts?.awaiting),
      refunded: num(orderCounts?.refunded),
    },
    gmv: toTotals(gmvRows),
    gmvMonth: toTotals(gmvMonthRows),
    catalogue: {
      products: num(catalogue?.products),
      published: num(catalogue?.published),
      digital: num(catalogue?.digital),
      services: num(catalogue?.services),
    },
    buyers: {
      total: num(audience?.buyers),
      month: num(audience?.newMonth),
    },
    visits: {
      month: num(traffic?.month),
      week: num(traffic?.week),
    },
  };
}

/**
 * How far accounts get, as counts at each step.
 *
 * Every step is measured against the same denominator — everyone who ever
 * registered — so the drop between two steps is readable straight off the
 * numbers rather than needing a per-step base.
 */
export async function getActivationFunnel() {
  await requireStaff();
  const db = getDb();

  const [[users], [shopped], [stocked], [sold], [paid]] = await Promise.all([
    db.select({ n: sql<string>`count(*)` }).from(user).where(notStaff()),
    db
      .select({
        n: sql<string>`count(*)`,
        live: sql<string>`count(*) filter (where ${shops.isPublished} and ${shops.suspendedAt} is null)`,
      })
      .from(shops),
    db
      .select({ n: sql<string>`count(distinct ${products.shopId})` })
      .from(products),
    db.select({ n: sql<string>`count(distinct ${orders.shopId})` }).from(orders),
    db
      .select({ n: sql<string>`count(*)` })
      .from(shops)
      .where(
        or(
          and(
            isNull(shops.compPlan),
            ne(shops.plan, "free"),
            inArray(shops.subscriptionStatus, ENTITLED),
          ),
          isNotNull(shops.compPlan),
        ),
      ),
  ]);

  const registered = num(users?.n);

  return {
    registered,
    steps: [
      { key: "registered", label: "Registered", count: registered },
      { key: "shop", label: "Created a shop", count: num(shopped?.n) },
      { key: "live", label: "Shop is live", count: num(shopped?.live) },
      { key: "product", label: "Added a product", count: num(stocked?.n) },
      { key: "order", label: "Took an order", count: num(sold?.n) },
      { key: "paid", label: "On a paid plan", count: num(paid?.n) },
    ],
  };
}

/** Daily registrations, zero-filled so the chart has no holes. */
export async function getSignupSeries(days = 30) {
  await requireStaff();
  const { since, keys } = utcDayWindow(days);

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${user.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<string>`count(*)`,
    })
    .from(user)
    .where(and(gte(user.createdAt, since), notStaff()))
    .groupBy(sql`${user.createdAt}::date`);

  const byDay = new Map(rows.map((r) => [r.day, num(r.count)]));
  return keys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

/** Daily order count across every shop. Currency-free, so it always adds up. */
export async function getPlatformOrderSeries(days = 30) {
  await requireStaff();
  const { since, keys } = utcDayWindow(days);

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${orders.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<string>`count(*)`,
    })
    .from(orders)
    .where(gte(orders.createdAt, since))
    .groupBy(sql`${orders.createdAt}::date`);

  const byDay = new Map(rows.map((r) => [r.day, num(r.count)]));
  return keys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

/**
 * Daily volume in one currency.
 *
 * A single line can only honestly carry one currency, so the caller passes the
 * platform's biggest and the chart says which it is drawing.
 */
export async function getPlatformGmvSeries(currency: string, days = 30) {
  await requireStaff();
  const { since, keys } = utcDayWindow(days);

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${orders.createdAt}::date, 'YYYY-MM-DD')`,
      cents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, since), eq(orders.currency, currency)))
    .groupBy(sql`${orders.createdAt}::date`);

  const byDay = new Map(rows.map((r) => [r.day, num(r.cents)]));
  return keys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

/* -------------------------------------------------------------------------- */
/*  Accounts                                                                   */
/* -------------------------------------------------------------------------- */
