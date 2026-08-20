# 08 · Analytics

**0.5s shape:** a wall of small answers — KPI strip up top, a grid of titled
cards below, every title dotted-underlined (definitions on hover).

## Digested captures
- **Analytics page:** toolbar (Today ▾ · compare-date chip · currency chip;
  right: ⋯ · Try targets ▾ · New exploration). **KPI strip**: 4 tiles (Gross
  sales / Returning customer rate / Orders fulfilled / Orders) each value + tiny
  right-aligned sparkline. Grid 3-col: big "Total sales over time" line chart
  (2 series solid vs dashed compare) + "Total sales breakdown" ledger (Gross →
  Discounts → Returns → Net → Shipping → Tax → Total, blue drill links) + sales
  by channel/product/AOV/sessions/CR breakdown funnel bars/device donut/
  location bars/cohort matrix/landing pages/referrers… Every card title
  dotted-underline. Empty cards say "No data for this date range".
- **Live View:** left stat column (Visitors right now / Total sales / Sessions
  w/ pulse sparkline / Orders; Customer behavior 3-count row: Active carts /
  Checking out / Purchased; sessions-by-location bars; top products), RIGHT:
  dotted 3-D globe w/ location pins, legend chips, zoom/expand controls.

## Sailo target (P6)
New route `/admin/analytics` (rail: child of Overview? NO — top-level door
after Clients, icon BarChart3; palette + G-A chord).
1. Toolbar: existing RangePicker + compare toggle (compare = previous period,
   dashed series — our Chart already supports two series; wire a compare query).
2. KPI strip: Visits / Unique / Orders / Net revenue (sparklines, deltas).
3. Grid (all from EXISTING queries): revenue chart (compare) · visits chart ·
   **breakdown ledger** (gross/discounts/refunds/net/delivery/tax — all on
   dashboard stats today, presented as the ledger) · traffic sources · clicks ·
   product performance · conversion funnel (parallel agent's panel) · currency
   mix. Dotted-underline titles → title attr definitions (a11y: also visible
   focus tooltip).
4. Home keeps only the KPI strip + links here (03).
5. **Live view:** honest scope = "Today so far" card (today's visits/orders
   ticking via existing LiveRefresh) — no globe until we track geo sessions;
   the globe is a costume without the data. Say so in the page's empty note.

## Tasks
- [x] Route + door + chord G-A; panels moved (2026-08-20, browser-verified; page claims money:read, pin 166→167)
- [x] Compare-period query + dashed series (`dashed` flag in the chart package; past never takes a bar lane)
- [x] Breakdown ledger (two honest blocks: net path arithmetic + inside-gross composition — our gross is post-discount, a Shopify-style subtraction ledger would invent money); KPI deltas vs previous period
- [x] Metric definitions (DefTitle: dotted underline, hover + keyboard-focusable title)
