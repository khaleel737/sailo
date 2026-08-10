# 11 — Admin Analytics Upgrades

**Priority:** P2 · **Effort:** S · **Depends on:** 07 for the Leads tile,
10 for destinations (both optional — build what exists)

## What

Three additions to the admin dashboard, mirroring Stan's Analytics page:

1. **Per-product performance table** — Views · Orders · Conversion % ·
   Revenue per product.
2. **Custom date range** — today the presets are fixed; add from/to pickers.
3. **Leads tile** — once spec 07 lands (count in range).

## The data already exists

`visits.productId` (`src/db/schema/analytics.ts:41`) records product-page
views; orders + order_items carry per-product sales. Nothing new is written —
this is two read queries and UI.

## Build

- Query (in `src/lib/queries/analytics.ts`, where the dashboard reads
  already live — **note the read-replica rule**: this module is on the
  replica allowlist in `src/db/replica.test.ts`; keep new reads in it so the
  allowlist stays truthful):
  - views: `select productId, count(*) from visits where shopId and range
    group by productId` — run against the partitioned table; verify the plan
    prunes partitions by `createdAt` (EXPLAIN in the load script; see
    `scripts/check-load.ts`).
  - orders/revenue: join `order_items` → `orders` filtered to settled
    statuses (`paid`, and manual orders the seller confirmed — reuse
    whichever settled-filter the revenue rollup uses so two pages never
    disagree on "revenue").
  - conversion = orders / views, guarded against 0 views (render "—", not
    Infinity).
- Date range: presets (7d / 14d / 30d / custom). Custom is clamped
  server-side to the plan's `analyticsDays` limit (`src/lib/plans.ts`) — the
  free plan must not fetch a year by typing a URL param; over-limit requests
  show the upgrade modal, mirroring the CSV-export gate in
  `/api/export/[type]/route.ts`.
- Table sorted by revenue desc, capped with pagination at 50 (no silent
  truncation — show "showing top 50 of N", per the repo's no-silent-caps
  rule).

## Details that must not be missed

- Timezone: buckets in the shop's timezone if the dashboard already does so —
  match the existing rollup convention; do not introduce a second bucketing.
- Deleted/unpublished products still show (historical revenue is real);
  render the title from the order line snapshot (`order_items` carries
  product title) so a renamed product doesn't rewrite history.
- Currency formatting via `src/lib/currency.ts` with the shop currency.
- Strings in 35 admin locales; column headers included.

## Testing

Unit on the conversion math (0 views, 0 orders, both). Scenario: seed visits
with productId + place orders via `createOrderIntent`, assert the table rows
and that the settled-filter matches the revenue tile for the same range.

## Done when

Per-product table and custom ranges render with plan clamping, both numbers
agree with existing revenue tiles, and partition pruning is verified.
