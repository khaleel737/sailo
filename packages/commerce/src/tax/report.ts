import "server-only";
import { and, between, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { invoices, orders, taxRevenueDaily } from "@sailo/db/schema";
import {
  placeKey,
  thresholdFor,
  type PlaceRevenue,
} from "@sailo/core/tax-thresholds";
import { toCsv } from "@sailo/core/csv";

/**
 * What the seller files, and the check that says whether they can.
 *
 * The report reads `tax_revenue_daily` — a fold of stored minor units — and
 * then reconciles it against `orders` and the invoice sequence for the same
 * window. The reconciliation *is* the test: a report that disagrees with the
 * invoice sequence is a report nobody can file, and a seller has no way to tell
 * a wrong total from a right one by looking at it.
 *
 * Nothing here is tax advice. It states what was collected and where; the
 * conclusion is the seller's to draw.
 */

export type TaxReportRow = {
  key: string;
  country: string;
  region: string | null;
  currency: string;
  netCents: number;
  taxCents: number;
  b2bNetCents: number;
  orderCount: number;
  /** True where a published threshold exists for the place at all. */
  tracked: boolean;
};

export type TaxReport = {
  from: string;
  to: string;
  rows: TaxReportRow[];
  /** Totals per currency, because a shop can have changed its own. */
  totals: { currency: string; netCents: number; taxCents: number; orderCount: number }[];
  reconciliation: Reconciliation;
};

/**
 * Whether the fold still describes the orders it was folded from.
 *
 * Three numbers, taken straight from `orders` and `invoices` rather than from
 * the fold, and compared. `agrees` is false when they diverge, and the screen
 * says so in as many words instead of printing a total the seller would sign.
 *
 * `taxOutsideFold` is the honest name for the gap the fold deliberately leaves:
 * a partially refunded order contributes its net and not its tax, because the
 * split is not a fact Sailo stores and apportioning it would be a
 * re-derivation. It is reported rather than hidden.
 */
export type Reconciliation = {
  agrees: boolean;
  orderCount: number;
  foldedOrderCount: number;
  invoiceCount: number;
  /** Orders in the window with money returned, whose tax the fold excluded. */
  refundedOrderCount: number;
  refundedCents: number;
  taxOutsideFold: number;
};

/** `2026-01-01`, from a Date, in UTC. */
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function taxReport(opts: {
  shopId: string;
  from: Date;
  to: Date;
}): Promise<TaxReport> {
  const db = getDb();
  const from = day(opts.from);
  const to = day(opts.to);

  const [folded, actual] = await Promise.all([
    db
      .select({
        country: taxRevenueDaily.country,
        region: taxRevenueDaily.region,
        currency: taxRevenueDaily.currency,
        netCents: sql<number>`sum(${taxRevenueDaily.netCents})::bigint`,
        taxCents: sql<number>`sum(${taxRevenueDaily.taxCents})::bigint`,
        b2bNetCents: sql<number>`sum(${taxRevenueDaily.b2bNetCents})::bigint`,
        orderCount: sql<number>`sum(${taxRevenueDaily.orderCount})::int`,
      })
      .from(taxRevenueDaily)
      .where(
        and(
          eq(taxRevenueDaily.shopId, opts.shopId),
          between(taxRevenueDaily.day, from, to),
        ),
      )
      .groupBy(
        taxRevenueDaily.country,
        taxRevenueDaily.region,
        taxRevenueDaily.currency,
      ),
    /*
     * The same window read from the orders themselves.
     *
     * Deliberately not derived from the fold: two numbers that came from one
     * query agree by construction and prove nothing. This is the second
     * opinion.
     */
    db
      .select({
        orderCount: sql<number>`count(*)::int`,
        refundedOrderCount: sql<number>`count(*) filter (where ${orders.refundedCents} > 0)::int`,
        refundedCents: sql<number>`coalesce(sum(${orders.refundedCents}), 0)::bigint`,
        taxAll: sql<number>`coalesce(sum(${orders.taxCents}), 0)::bigint`,
        taxUnrefunded: sql<number>`coalesce(sum(${orders.taxCents}) filter (where ${orders.refundedCents} = 0), 0)::bigint`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.shopId, opts.shopId),
          eq(orders.paymentStatus, "paid"),
          sql`${orders.status} <> 'cancelled'`,
          sql`(${orders.createdAt})::date between ${from} and ${to}`,
        ),
      ),
  ]);

  const invoiceCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .innerJoin(orders, eq(invoices.orderId, orders.id))
    .where(
      and(
        eq(invoices.shopId, opts.shopId),
        eq(orders.paymentStatus, "paid"),
        sql`${orders.status} <> 'cancelled'`,
        sql`(${orders.createdAt})::date between ${from} and ${to}`,
      ),
    );

  const rows: TaxReportRow[] = folded
    .map((r) => ({
      key: placeKey(r.country || "??", r.region || null),
      country: r.country,
      region: r.region || null,
      currency: r.currency,
      netCents: Number(r.netCents),
      taxCents: Number(r.taxCents),
      b2bNetCents: Number(r.b2bNetCents),
      orderCount: Number(r.orderCount),
      tracked: thresholdFor(r.country || null, r.region || null) !== null,
    }))
    .toSorted(
      (a, b) => b.taxCents - a.taxCents || a.key.localeCompare(b.key),
    );

  const totals = [
    ...rows
      .reduce((map, r) => {
        const t = map.get(r.currency) ?? {
          currency: r.currency,
          netCents: 0,
          taxCents: 0,
          orderCount: 0,
        };
        t.netCents += r.netCents;
        t.taxCents += r.taxCents;
        t.orderCount += r.orderCount;
        map.set(r.currency, t);
        return map;
      }, new Map<string, TaxReport["totals"][number]>())
      .values(),
  ].toSorted((a, b) => a.currency.localeCompare(b.currency));

  const a = actual[0] ?? {
    orderCount: 0,
    refundedOrderCount: 0,
    refundedCents: 0,
    taxAll: 0,
    taxUnrefunded: 0,
  };
  const foldedOrderCount = rows.reduce((n, r) => n + r.orderCount, 0);
  const foldedTax = rows.reduce((n, r) => n + r.taxCents, 0);

  return {
    from,
    to,
    rows,
    totals,
    reconciliation: {
      /*
       * Two things have to hold. Every paid order in the window is in the fold
       * — a missing one means the nightly job has not reached this far back and
       * the seller is looking at an incomplete period. And the tax the fold
       * carries is exactly the tax on the orders it did not exclude.
       */
      agrees:
        foldedOrderCount === Number(a.orderCount) &&
        foldedTax === Number(a.taxUnrefunded),
      orderCount: Number(a.orderCount),
      foldedOrderCount,
      invoiceCount: Number(invoiceCount[0]?.n ?? 0),
      refundedOrderCount: Number(a.refundedOrderCount),
      refundedCents: Number(a.refundedCents),
      taxOutsideFold: Number(a.taxAll) - Number(a.taxUnrefunded),
    },
  };
}

/**
 * The report as a file.
 *
 * Amounts as minor units *and* as a decimal string, the same rule the REST API
 * follows: the most common integration bug is somebody mapping the integer and
 * telling their accountant 4999.
 */
export function taxReportCsv(report: TaxReport): string {
  return toCsv(
    ["country", "region", "currency", "orders", "net", "tax", "b2b_net", "net_minor", "tax_minor", "b2b_net_minor"],
    report.rows.map((r) => [
      r.country || "(not recorded)",
      r.region ?? "",
      r.currency,
      String(r.orderCount),
      decimal(r.netCents, r.currency),
      decimal(r.taxCents, r.currency),
      decimal(r.b2bNetCents, r.currency),
      String(r.netCents),
      String(r.taxCents),
      String(r.b2bNetCents),
    ]),
  );
}

function decimal(minor: number, currency: string): string {
  const places = currency.toUpperCase() === "JPY" ? 0 : 2;
  return (minor / 10 ** places).toFixed(places);
}

/** The fold, in the shape the threshold arithmetic wants. */
export async function placeRevenueFor(opts: {
  shopId: string;
  from: Date;
  to: Date;
}): Promise<PlaceRevenue[]> {
  const db = getDb();
  const rows = await db
    .select({
      country: taxRevenueDaily.country,
      region: taxRevenueDaily.region,
      currency: taxRevenueDaily.currency,
      netCents: sql<number>`sum(${taxRevenueDaily.netCents})::bigint`,
      taxCents: sql<number>`sum(${taxRevenueDaily.taxCents})::bigint`,
      b2bNetCents: sql<number>`sum(${taxRevenueDaily.b2bNetCents})::bigint`,
      orderCount: sql<number>`sum(${taxRevenueDaily.orderCount})::int`,
    })
    .from(taxRevenueDaily)
    .where(
      and(
        eq(taxRevenueDaily.shopId, opts.shopId),
        between(taxRevenueDaily.day, day(opts.from), day(opts.to)),
      ),
    )
    .groupBy(
      taxRevenueDaily.country,
      taxRevenueDaily.region,
      taxRevenueDaily.currency,
    );

  return rows
    .filter((r) => r.country)
    .map((r) => ({
      country: r.country,
      region: r.region || null,
      currency: r.currency,
      netB2cMinor: Number(r.netCents),
      netB2bMinor: Number(r.b2bNetCents),
      taxMinor: Number(r.taxCents),
      orderCount: Number(r.orderCount),
    }));
}
