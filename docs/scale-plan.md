# Scale plan: Neon optimization, Singapore, and cell-based routing

*Decided 2026-08-08, after measured load testing and four-track vendor research.
This is the standing plan; revisit at the triggers in each phase.*

## What was measured and decided

- Local load test (Postgres 17, real schema, 50k seeded shops, real checkout
  statement shape): **~500 orders/sec ceiling, zero errors** — 57× the
  projected 750k orders/day. Scripts: session scratchpad `seed.sql` / `load.js`.
- No shipped product delivers per-tenant regional placement on this stack today.
  Nile's Global Placement is "Coming Soon" (no Asia region at all); Multigres is
  a single-shard alpha; PlanetScale's Neki is private; CockroachDB's
  REGIONAL BY ROW is real but Asia regions are Advanced-tier (~$4–10k/mo) and
  Drizzle support is RC-only; Aurora DSQL still lacks enforced foreign keys;
  Citus is single-region; pgcat is dormant.
- Vercel routes multi-region functions by **user proximity** with no tenant-pin
  mechanism (`preferredRegion` is deprecated in Next 16). Per-tenant routing
  therefore means one Vercel project per cell behind a thin router — never
  "more regions" on one project, which actively *worsens* tenant-homed latency.
- Fluid Compute shares instances across invocations (documented), so a
  module-level `pg.Pool` + `attachDatabasePool()` is the sanctioned connection
  pattern; Neon itself now recommends pooled TCP over its HTTP driver on Fluid.
- Neon regions are immutable; Asia = Singapore (`aws-ap-southeast-1`) only.
  Read replicas are same-region only; cross-region replication = manual
  logical replication between projects (no DDL, slots GC'd after ~40h idle) —
  suitable for one-off moves and DR seeding, not a serving tier.

## Phase 0 — round-trip collapse + Neon settings (code only)

1. Add a TCP path beside neon-http: `pg.Pool` on the pooled connection string,
   `attachDatabasePool(pool)`, Drizzle node-postgres driver. Move
   `createOrderIntent`'s writes (client upsert → guarded stock takes → order +
   items) into one interactive transaction — this also retires the
   "neon-http can't open transactions" constraint and simplifies the stock-undo
   paths.
2. Compress intent-resolution reads: join products+variants; parallelize the
   independent reads. Target: checkout ≈ 3–4 round trips (from ~12).
3. Neon: prod primary min 1 CU (no scale-to-zero), autoscale to 4–8 CU.
   Pooled string for the app; direct string for migrations only.
4. Probe before believing: one route timing the sequence three ways
   (http-sequential / `db.batch()` / TCP transaction) deployed to `sin1` and
   `iad1` previews against Neon branches in Singapore and us-east-1.

## Phase 1 — relocate the pair to Singapore

New Neon project in `aws-ap-southeast-1` (region is immutable — migration, not
setting). Small DB ⇒ maintenance-window dump/restore; logical replication only
if zero-downtime is required. Pin functions `"regions": ["sin1"]`. Keep the old
project as rollback for two weeks. Storefront reads are edge-cached and
unaffected. Outcome: 56% of users (PH/VN/CN cohort) at ~35–50ms for dynamic
requests; US/EU pay one WAN hop on a 3–4-round-trip checkout.

## Phase 2 — cells (on trigger, not on schedule)

Three cells: `sin1`+SG Neon (exists after Phase 1), `iad1`+us-east-1,
`fra1`+eu-central-1. One Vercel project per cell from this repo
(`CELL_ID` env), pinned to its region, talking only to its co-located Neon.
A shop lives wholly in one cell. No live cross-region replication.

Build list (~300–600 LOC + one refactor):

1. **Control plane**: global catalog (`handle → cell`,
   `stripeAccountId/customerId → cell`, auth users) in a small global Neon
   project; hot routing map mirrored to Edge Config.
2. **Router**: thin apex-domain project; Routing Middleware reads Edge Config,
   proxies via external rewrite to the owning cell. Custom-domain shops attach
   their domain directly to the cell project (no router hop).
3. **Cell-aware data layer**: `getDb(cell)` client map; tenant id becomes an
   explicit argument of every cached function — a tenant DB chosen via side
   channel inside `use cache` leaks one tenant's data into another's cache
   entry. Each cell prerenders only its own shops.
4. **Webhooks**: per-cell Stripe endpoints with per-cell `stripe_events`
   dedupe; catalog resolves stray lookups.
5. **Ops**: CI migration fan-out; per-cell crons (stock sweep); shop-mover
   script later (copy rows by `shopId`, flip registry).
6. **Rollout**: spike with ~100 synthetic shops in cell 2; then migrate the
   US/EU cohort; Asia never moves.

**Triggers**: contractual EU data residency · measured far-region conversion
loss · a region's writes approaching the measured ceiling · a China strategy
requiring separation.

## Load handling

Proven: 500 orders/s per Postgres at this write shape; 200/s at p99 19ms;
peak writes + 1k reads/s concurrent, zero errors. In place: per-IP order rate
limit, idempotent webhooks, per-shop cache tags. Watch: email throughput
(buffer via `after()`/queue near Resend limits), invalidation granularity on
hot shops, Fluid instance-count × pool-size vs Neon connection caps at rollout.
Re-run the load test against a Neon branch pre-launch.

## Second research pass: multi-master and everything else (2026-08-08)

A follow-up sweep covered the categories the first pass missed. None changed
the decision; two entries amended the plan.

- **pgEdge (active-active Spock)**: cannot make the guarded stock decrement
  safe — delta-apply is an unbounded-counter CRDT, the `stock >= N` guard only
  runs against the origin node's stale value, so two regions can both pass it
  and converge to negative stock; a CHECK turns oversell into a replication
  stall. pgEdge's own guidance is to pin writes per region — i.e. tenant
  homing, rebuilt on multi-master machinery plus Snowflake-sequence PKs,
  FKs unenforced on apply, and quiesce-for-DDL migrations. Ruled out.
- **YugabyteDB Aeon (partition-by-region)**: the honest "tenant homing inside
  one database" product — safe decrements, Singapore/Jakarta/Tokyo available,
  Drizzle works. Costs ~$3.5–7k/mo minimum and threads a region column through
  every PK/unique/FK. **Recorded as the fallback if Neon cells ever prove
  operationally heavy.**
- **EDB PGD**: Quorum Commit (May 2026) genuinely fixes the bounded-counter
  problem — by paying cross-region round trips inside every commit, defeating
  the latency purpose; enterprise procurement besides. Watch, don't buy.
- **Spanner PG dialect**: no Singapore-write multi-region config, no Drizzle
  support (PGAdapter sidecar required). Out. **TiDB**: MySQL wire only. Out.
- **Postgres edge caches**: PolyScale is dead (domain for sale); Prisma
  Accelerate is Prisma-Client-only; ReadySet must sit beside the primary;
  Hyperdrive is Workers-only. Category effectively empty for this stack.
- **Sync engines**: unfit for checkout by design (writes need one authority) —
  but **ElectricSQL is a real optional Phase 1.5**: per-tenant read-path
  "shapes" served over CDN-cacheable HTTP would erase far-region latency for
  seller admin dashboards without touching the write path (self-serve since
  Apr 2026, ~$2/M writes emitted). Adopt when far-region seller complaints
  materialize; PowerSync instead if a seller mobile app ships.
- **Queue-based checkout** (Vercel Queues beta + Workflow GA): a contention
  pattern, not a latency fix — confirmation still crosses the ocean and stock
  races become after-the-fact rejections. Back pocket for a future flash-sale
  feature only.

## Standing risks and watchlist

- **Mainland China (20k shops)**: unserved by every option researched — no
  mainland regions anywhere; GFW transit variable. ICP/partner/CDN decision,
  independent of database architecture.
- **Buy-over-build checkpoints**: Multigres ships production sharding · Neki
  goes public · Nile ships Global Placement *and* an Asia region · CockroachDB
  Standard reaches Tokyo/Seoul/Jakarta with stable Drizzle support · Neon
  revives cross-region replicas (dormant epic since 2023).
- Vercel doc inconsistency: Pro function-region count reads 5 in the regions
  doc, 3 in the Fluid doc — confirm in the dashboard before relying on it.
- Neon was acquired by Databricks (~$1B, closed 2025; tech underpins
  Lakebase). No immediate risk; watch roadmap attention and pricing.
- EDB PGD Quorum Commit maturing into a small-team-buyable product would
  reopen the multi-master question; as of Aug 2026 it is ~10 weeks old and
  enterprise-only.
