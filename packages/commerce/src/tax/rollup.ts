import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@sailo/db";

/**
 * Folding paid orders into `tax_revenue_daily`.
 *
 * EVERY FIGURE IS A SUM OF STORED MINOR UNITS
 *
 * Nothing in here multiplies by a rate. `orders.tax_cents` is what the buyer
 * was actually charged and what their invoice says; re-deriving it from
 * `tax_rate_bp × net` answers a different question and disagrees with both the
 * invoice the buyer holds and the return the seller files. The column's own
 * comment says it is a snapshot for exactly this reason. Spec 38 says it twice.
 *
 * RE-FOLDING, NOT ACCUMULATING
 *
 * A day is recomputed from the orders it contains rather than incremented,
 * because a refund has to reduce *the period it belongs to* — money returned in
 * September against an August sale is August's number that changes, not
 * September's. An accumulating fold cannot express that; a re-fold gets it for
 * free, and it also makes the job idempotent, so two overlapping cron ticks
 * write the same rows rather than doubling a shop's year.
 *
 * The window is bounded because re-folding every shop's whole history nightly
 * is not a thing that stays cheap. `REFOLD_DAYS` is 120 — the card networks'
 * chargeback window, which is the outer edge of when an order's money can still
 * move without somebody in the admin doing it by hand. Anything older is
 * re-folded only by an explicit backfill, and the report says which window it
 * trusted.
 */

/** How far back a nightly run re-reads. See the header. */
export const REFOLD_DAYS = 120;

/**
 * Where an order with no stated country is filed.
 *
 * Empty string, not null: `country` is in the primary key, and NULL would let
 * the same day be folded twice. Digital orders genuinely have no address, and
 * dropping them would make the report stop reconciling against the invoice
 * sequence — which is the one property that makes it filable. The screen shows
 * this row explicitly as "not recorded" rather than quietly folding it into a
 * country it might not belong to.
 */
export const UNKNOWN_PLACE = "";

export type RollupResult = {
  shops: number;
  rows: number;
  from: string;
  ms: number;
};

/**
 * Re-fold the window for one shop, or for every shop that sold in it.
 *
 * One statement per run rather than one per shop: this reads a bounded window
 * of `orders`, groups it, and upserts. A fleet-wide nightly job that opened a
 * transaction per shop would spend its whole budget on round trips.
 *
 * Written as one `sql` template rather than through the query builder because
 * it is an `INSERT … SELECT … GROUP BY` over computed expressions, and the
 * builder's version of that reads as three layers of indirection over a
 * statement anybody can check by pasting it into psql. The three expressions
 * appear twice each — once in the select list, once in the GROUP BY — which is
 * the ordinary cost of that shape and is why they are named in comments.
 */
export async function rollUpTaxRevenue(
  opts: { shopId?: string; days?: number; now?: Date } = {},
): Promise<RollupResult> {
  const started = Date.now();
  const db = getDb();
  const now = opts.now ?? new Date();
  const days = opts.days ?? REFOLD_DAYS;

  const from = new Date(now.getTime() - days * 86_400_000);
  const fromDay = from.toISOString().slice(0, 10);

  /*
   * What counts, and the three filters that decide it.
   *
   *   paid          — an unpaid order collected no tax and owes none. A manual
   *                   rail order sitting unpaid for a week is not revenue.
   *   not cancelled — it never happened.
   *   the window    — see the header.
   *
   * `net_cents` is total minus tax minus whatever was refunded, so a refund
   * lands on the day of the sale. `tax_cents` counts only orders with nothing
   * refunded: a partial refund's tax split is not a fact Sailo stores, and
   * apportioning it would be exactly the re-derivation the spec forbids. The
   * report shows the refunded orders as their own line, so that exclusion is
   * visible rather than silent.
   *
   * `b2b_net_cents` is separate rather than a filter applied later, because
   * only sales to individuals move a registration threshold — a filter at read
   * time is a filter somebody forgets, on the one screen where forgetting it
   * says "you are fine" to a seller who is not. A buyer counts as B2B when they
   * gave a validated tax id or the liability moved to them under the reverse
   * charge; both are facts Stripe recorded on the order.
   */
  const shopFilter = opts.shopId
    ? sql`and o.shop_id = ${opts.shopId}::uuid`
    : sql``;

  const inserted = await db.execute(sql`
    insert into tax_revenue_daily
      (shop_id, country, region, day, currency,
       net_cents, tax_cents, b2b_net_cents, order_count, updated_at)
    select
      o.shop_id,
      coalesce(upper(nullif(btrim(o.country), '')), '')        as country,
      coalesce(upper(nullif(btrim(o.region), '')), '')         as region,
      (o.created_at)::date                                     as day,
      o.currency,
      coalesce(sum(o.total_cents - o.tax_cents - o.refunded_cents)
                 filter (where o.buyer_tax_id is null and not o.tax_reverse_charge), 0),
      coalesce(sum(o.tax_cents) filter (where o.refunded_cents = 0), 0),
      coalesce(sum(o.total_cents - o.tax_cents - o.refunded_cents)
                 filter (where o.buyer_tax_id is not null or o.tax_reverse_charge), 0),
      count(*),
      now()
    from orders o
    where o.payment_status = 'paid'
      and o.status <> 'cancelled'
      and o.created_at >= ${from}
      ${shopFilter}
    group by
      o.shop_id,
      coalesce(upper(nullif(btrim(o.country), '')), ''),
      coalesce(upper(nullif(btrim(o.region), '')), ''),
      (o.created_at)::date,
      o.currency
    on conflict (shop_id, country, region, day, currency) do update set
      -- Assignment, never accumulation. The whole point of a re-fold is that
      -- today's read of the day replaces whatever was there, so a refund can
      -- lower it.
      net_cents     = excluded.net_cents,
      tax_cents     = excluded.tax_cents,
      b2b_net_cents = excluded.b2b_net_cents,
      order_count   = excluded.order_count,
      updated_at    = now()
    returning shop_id
  `);

  const rows = (inserted.rows ?? []) as { shop_id: string }[];

  return {
    shops: new Set(rows.map((r) => r.shop_id)).size,
    rows: rows.length,
    from: fromDay,
    ms: Date.now() - started,
  };
}
