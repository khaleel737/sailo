/**
 * Turns `visits` into a table partitioned by month.
 *
 *   npm run db:partition            # report only, changes nothing
 *   npm run db:partition -- --apply # do it
 *
 * WHY
 * Measured on the live database before this ran: 1,530 rows, 352kB of heap,
 * and **78MB of indexes**. Postgres had recorded three million deletes against
 * the table, because retention was a nightly `DELETE`. Autovacuum reclaims the
 * heap and leaves the B-trees — index pages are marked reusable but never
 * returned to the operating system — so the busiest table in the product was
 * also its largest, holding almost nothing.
 *
 * Partitioned, retention becomes `DROP TABLE` on a whole month: data and
 * indexes go together, in one catalogue operation, with nothing left to vacuum.
 * The rebuild also reclaims the 78MB, because the data lands in fresh indexes.
 *
 * HOW IT STAYS SAFE
 * Nothing is destroyed. The new table is built alongside, filled, counted
 * against the original, and only then swapped in; the original is left behind
 * as `visits_legacy` for you to drop once you believe it. If anything fails
 * before the swap, the live table has not been touched at all.
 *
 * The swap itself is one transaction, so there is no moment where `visits`
 * does not exist.
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const sql = neon(url);

/** Indexes the app actually reads by. Recreated on the parent, inherited down. */
const INDEXES: { name: string; columns: string }[] = [
  { name: "visits_shop_idx", columns: "(shop_id)" },
  { name: "visits_created_idx", columns: "(created_at)" },
  { name: "visits_shop_created_idx", columns: "(shop_id, created_at)" },
];

const monthStart = (d: Date, offset = 0): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const partName = (d: Date): string =>
  `visits_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

async function report(label: string): Promise<{ rows: number; total: string }> {
  /*
   * Sizes must include the partitions. `pg_relation_size` on a partitioned
   * parent is zero — the parent holds no rows — so measuring it alone reported
   * "79 MB → 0 bytes", which is a wonderful number and a false one.
   */
  const [row] = (await sql`
    with tree as (
      select 'public.visits'::regclass as oid
      union all
      select c.oid from pg_class c
        join pg_inherits i on i.inhrelid = c.oid
      where i.inhparent = 'public.visits'::regclass
    )
    select (select count(*) from visits)::int as rows,
           pg_size_pretty(sum(pg_relation_size(oid)))       as heap,
           pg_size_pretty(sum(pg_indexes_size(oid)))        as indexes,
           pg_size_pretty(sum(pg_total_relation_size(oid))) as total,
           (select relkind from pg_class where oid = 'public.visits'::regclass) as kind
    from tree`) as {
    rows: number;
    heap: string;
    indexes: string;
    total: string;
    kind: string;
  }[];
  if (!row) throw new Error("visits does not exist");
  console.log(
    `${label}: ${row.rows} rows · heap ${row.heap} · indexes ${row.indexes} · total ${row.total} · ${row.kind === "p" ? "PARTITIONED" : "plain table"}`,
  );
  return { rows: row.rows, total: row.total };
}

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "Applying.\n"
      : "Dry run — nothing will change. Pass --apply to do it.\n",
  );

  const before = await report("before");

  const kindRows = (await sql`
    select relkind as kind from pg_class where oid = 'public.visits'::regclass`) as {
    kind: string;
  }[];
  if (kindRows[0]?.kind === "p") {
    console.log("\nAlready partitioned. Nothing to do.");
    return;
  }

  /*
   * The window to cover: every month that already holds data, plus a few ahead.
   * A row whose timestamp matches no partition is rejected — an insert does not
   * fall back to the parent — so the future must exist before it arrives.
   */
  const [span] = (await sql`
    select min(created_at) as oldest, max(created_at) as newest from visits`) as {
    oldest: string | null;
    newest: string | null;
  }[];
  const oldest = span?.oldest ? new Date(span.oldest) : new Date();
  const newest = span?.newest ? new Date(span.newest) : new Date();
  const last = monthStart(newest, 3);

  const months: Date[] = [];
  for (let m = monthStart(oldest); m <= last; m = monthStart(m, 1))
    months.push(m);
  console.log(
    `\nPartitions to create (${months.length}): ${months.map(partName).join(", ")}`,
  );

  if (!APPLY) {
    console.log(
      "\nWould: build visits_new, copy rows, verify the count, then swap.",
    );
    console.log("Original kept as visits_legacy — nothing is dropped.");
    return;
  }

  console.log("\nBuilding…");
  await sql`create schema if not exists visits_parts`;
  await sql`drop table if exists visits_new cascade`;

  /*
   * `LIKE` copies the columns, their types and their defaults exactly, so this
   * cannot drift from the real table the way a hand-written column list would.
   * It does not copy foreign keys or indexes; those follow.
   */
  await sql`
    create table visits_new (like visits including defaults including constraints)
    partition by range (created_at)`;

  // A partitioned table's primary key must contain the partition key — the
  // uuid alone cannot be unique across partitions the planner may not read.
  await sql`alter table visits_new add primary key (id, created_at)`;
  await sql`
    alter table visits_new add constraint visits_new_shop_id_fk
      foreign key (shop_id) references shops(id) on delete cascade`;
  await sql`
    alter table visits_new add constraint visits_new_product_id_fk
      foreign key (product_id) references products(id) on delete cascade`;

  for (const month of months) {
    const name = partName(month);
    await sql.query(
      `create table if not exists visits_parts.${name}
       partition of visits_new
       for values from ('${isoDay(month)}') to ('${isoDay(monthStart(month, 1))}')`,
    );
  }
  console.log(`  ${months.length} partitions created`);

  for (const index of INDEXES) {
    await sql.query(
      `create index ${index.name}_new on visits_new ${index.columns}`,
    );
  }
  console.log(`  ${INDEXES.length} indexes created`);

  console.log("Copying…");
  await sql`insert into visits_new select * from visits`;

  const [check] = (await sql`
    select (select count(*) from visits)::int as old,
           (select count(*) from visits_new)::int as copied`) as {
    old: number;
    copied: number;
  }[];
  if (!check) throw new Error("could not count the copy");
  console.log(`  ${check.copied} of ${check.old} rows copied`);
  if (check.copied !== check.old) {
    throw new Error(
      `row count mismatch: ${check.copied} copied vs ${check.old} original — nothing has been swapped, the live table is untouched`,
    );
  }

  /*
   * One transaction for the swap, so there is never an instant without a
   * `visits` table. Neon's HTTP driver runs an array of queries atomically,
   * which is exactly this and avoids taking a websocket dependency for one
   * statement's worth of work.
   */
  console.log("Swapping…");
  await sql.transaction([
    sql`alter table visits rename to visits_legacy`,
    sql`alter index visits_pkey rename to visits_legacy_pkey`,
    // Identifiers, not values — and every one of them a constant in this file,
    // never anything a request could reach.
    ...INDEXES.map(
      (index) =>
        sql`alter index ${sql.unsafe(index.name)} rename to ${sql.unsafe(`${index.name}_legacy`)}`,
    ),
    sql`alter table visits_new rename to visits`,
    ...INDEXES.map(
      (index) =>
        sql`alter index ${sql.unsafe(`${index.name}_new`)} rename to ${sql.unsafe(index.name)}`,
    ),
  ]);

  console.log("");
  const after = await report("after ");
  console.log(
    `\nRows ${before.rows} → ${after.rows}. Size ${before.total} → ${after.total}.`,
  );
  console.log(
    "\nThe original is still there as `visits_legacy`. Once the dashboards look right:" +
      "\n  drop table visits_legacy;",
  );
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  console.error("The live table has not been swapped.");
  process.exit(1);
});
