/**
 * Answers "will this hold up at N shops?" by making it true and measuring.
 *
 * Generates synthetic shops, products, variants, orders and visits, runs the
 * queries the storefront and admin actually issue with EXPLAIN ANALYZE, then
 * deletes everything it made. Nothing is estimated — the plans and the timings
 * come from the real database at real volume.
 *
 *   npm run check:load          # 5000 shops × 10 products
 *   SHOPS=20000 npm run check:load
 */
import { present } from "@/lib/invariant";
import { neon } from "@neondatabase/serverless";

const sql = neon(present(process.env.DATABASE_URL, "DATABASE_URL"));
const SHOPS = Number(process.env.SHOPS ?? 5000);
const PER_SHOP = Number(process.env.PRODUCTS_PER_SHOP ?? 10);
const TAG = "loadtest-";

async function generate() {
  console.log(`Generating ${SHOPS.toLocaleString()} shops × ${PER_SHOP} products…`);
  await sql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    select ${TAG} || g, 'Load ' || g, ${TAG} || g || '@example.com', true, now(), now()
    from generate_series(1, ${SHOPS}) g on conflict do nothing`;
  await sql`
    insert into shops (user_id, handle, name, currency, plan, subscription_status, is_published, affiliates_enabled)
    select ${TAG} || g, ${TAG} || g, 'Load shop ' || g, 'USD', 'free', 'active', true, true
    from generate_series(1, ${SHOPS}) g on conflict do nothing`;
  await sql`
    insert into products (shop_id, title, slug, description, price_cents, kind, is_published, position, in_stock)
    select s.id, 'Product ' || p, 'product-' || p, 'Synthetic product for load testing.',
           1000 + (p * 137) % 9000, (array['physical','digital','service'])[1 + (p % 3)], true, p, true
    from shops s cross join generate_series(1, ${PER_SHOP}) p
    where s.handle like ${TAG + "%"} on conflict do nothing`;
  await sql`
    insert into product_variants (product_id, options, price_cents, position)
    select pr.id, jsonb_build_object('Size', v.name), 1200 + v.n * 300, v.n
    from products pr join shops s on s.id = pr.shop_id
    cross join (values ('Small',0),('Medium',1),('Large',2)) as v(name, n)
    where s.handle like ${TAG + "%"} and (pr.position % 3) = 0`;
  await sql`
    insert into orders (shop_id, product_id, product_title, unit_price_cents, quantity, item_count,
                        currency, subtotal_cents, total_cents, payment_method, payment_status, status, created_at)
    select pr.shop_id, pr.id, pr.title, pr.price_cents, 1, 1, 'USD', pr.price_cents, pr.price_cents,
           'whatsapp', 'unpaid', 'new', now() - (random() * interval '60 days')
    from products pr join shops s on s.id = pr.shop_id
    where s.handle like ${TAG + "%"} and (pr.position % 5) = 0`;
  await sql`
    insert into visits (shop_id, session_id, source, device, created_at)
    select s.id, md5(random()::text), 'social', 'mobile', now() - (random() * interval '30 days')
    from shops s cross join generate_series(1, 20) g where s.handle like ${TAG + "%"}`;
  await sql`analyze`;
}

async function measure() {
  const [shop] = await sql`select id, handle from shops where handle like ${TAG + "%"} limit 1`;
  if (!shop) {
    throw new Error(`No load-test shop found — run the generate step first.`);
  }
  let worst = 0;
  const seqScans: string[] = [];

  const plan = async (label: string, rows: Record<string, string>[]) => {
    const text = rows.map((r) => r["QUERY PLAN"]).join("\n");
    const seq = [...text.matchAll(/Seq Scan on (\w+)/g)].map((m) => m[1]);
    const exec = Number(/Execution Time: ([\d.]+)/.exec(text)?.[1] ?? 0);
    worst = Math.max(worst, exec);
    seq.forEach((s) => seqScans.push(`${label}: ${s}`));
    console.log(
      `  ${label.padEnd(32)} ${(exec.toFixed(3) + "ms").padStart(10)}` +
        (seq.length ? `   seq scan on ${[...new Set(seq)].join(", ")}` : ""),
    );
  };

  console.log("\nStorefront, per page view");
  await plan("shop by handle", await sql`explain (analyze) select * from shops where handle = ${shop.handle}`);
  await plan("published products", await sql`explain (analyze) select * from products where shop_id = ${shop.id} and is_published order by is_featured desc, position limit 60`);
  await plan("variants", await sql`explain (analyze) select * from product_variants where product_id in (select id from products where shop_id = ${shop.id})`);
  await plan("images", await sql`explain (analyze) select * from product_images where product_id in (select id from products where shop_id = ${shop.id})`);

  console.log("\nAdmin");
  await plan("order rollup", await sql`explain (analyze) select count(*), sum(total_cents) from orders where shop_id = ${shop.id}`);
  await plan("visits 30d", await sql`explain (analyze) select count(*), count(distinct session_id) from visits where shop_id = ${shop.id} and created_at > now() - interval '30 days'`);
  await plan("orders list", await sql`explain (analyze) select * from orders where shop_id = ${shop.id} order by created_at desc limit 100`);

  console.log("\nToken lookups (must never scan)");
  await plan("download token", await sql`explain (analyze) select * from orders where download_token = 'none'`);
  await plan("portal token", await sql`explain (analyze) select * from affiliates where portal_token = 'none'`);
  await plan("invoice token", await sql`explain (analyze) select * from invoices where token = 'none'`);

  const rows = Number(
    (await sql`select count(*)::int n from products`)[0]?.n ?? 0,
  );
  const size = String(
    (await sql`select pg_size_pretty(pg_database_size(current_database())) s`)[0]
      ?.s ?? "unknown",
  );
  console.log(`\n  ${rows.toLocaleString()} products · database ${size} · slowest query ${worst.toFixed(2)}ms`);
  return { worst, seqScans };
}

async function cleanup() {
  await sql`delete from "user" where id like ${TAG + "%"}`;
  await sql`delete from shops where handle like ${TAG + "%"}`;
  await sql`analyze`;
  console.log("\nSynthetic data removed.");
}

async function main() {
  try {
    await generate();
    const { worst } = await measure();
    await cleanup();
    // A per-shop query creeping into double digits means an index stopped
    // being used, which at this volume is the whole point of the check.
    if (worst > 50) {
      console.error(`\nSlowest query was ${worst.toFixed(1)}ms — something lost its index.`);
      process.exit(1);
    }
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
