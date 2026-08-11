import "server-only";
import { requireStaff } from "@/lib/session";
import { desc, eq, sql } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import { affiliates, clients, orders, products, shops, user } from "@sailo/db/schema";
import { num } from "./pagination";
import { notStaff } from "./roster";

/** Bulk reads for CSV export. Capped — a full table is not a download. */

/** Rows for the CSV exports, unpaginated but bounded. */
export async function getAllAccountsForExport(limit = 5000) {
  await requireStaff();
  const rows = await getReadDb()
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      joinedAt: user.createdAt,
      shop: shops,
      productCount: sql<string>`(select count(*) from products p where p.shop_id = shops.id)`,
      orderCount: sql<string>`(select count(*) from orders o where o.shop_id = shops.id)`,
      gmvCents: sql<string>`(select coalesce(sum(o.total_cents - o.refunded_cents), 0) from orders o where o.shop_id = shops.id and o.status <> 'cancelled')`,
    })
    .from(user)
    .leftJoin(shops, eq(shops.userId, user.id))
    // Same rule as the accounts page: the export is our customers, not us.
    .where(notStaff())
    .orderBy(desc(user.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    productCount: num(r.productCount),
    orderCount: num(r.orderCount),
    gmvCents: num(r.gmvCents),
  }));
}

export async function getAllOrdersForExport(limit = 10000) {
  await requireStaff();
  return getReadDb()
    .select({
      order: orders,
      shopName: shops.name,
      shopHandle: shops.handle,
      ownerEmail: user.email,
    })
    .from(orders)
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .innerJoin(user, eq(user.id, shops.userId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

export async function getAllProductsForExport(limit = 10000) {
  await requireStaff();
  return getReadDb()
    .select({
      product: products,
      shopName: shops.name,
      shopHandle: shops.handle,
      currency: shops.currency,
    })
    .from(products)
    .innerJoin(shops, eq(shops.id, products.shopId))
    .orderBy(desc(products.createdAt))
    .limit(limit);
}

export async function getAllAffiliatesForExport(limit = 10000) {
  await requireStaff();
  const rows = await getReadDb()
    .select({
      affiliate: affiliates,
      shopHandle: shops.handle,
      currency: shops.currency,
      orderCount: sql<string>`(select count(*) from orders o where o.affiliate_id = affiliates.id)`,
      earnedCents: sql<string>`(select coalesce(sum(o.commission_cents), 0) from orders o where o.affiliate_id = affiliates.id)`,
      unpaidCents: sql<string>`(select coalesce(sum(o.commission_cents), 0) from orders o where o.affiliate_id = affiliates.id and not o.commission_paid)`,
    })
    .from(affiliates)
    .innerJoin(shops, eq(shops.id, affiliates.shopId))
    .orderBy(desc(affiliates.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    orderCount: num(r.orderCount),
    earnedCents: num(r.earnedCents),
    unpaidCents: num(r.unpaidCents),
  }));
}

export async function getAllBuyersForExport(limit = 10000) {
  await requireStaff();
  const rows = await getReadDb()
    .select({
      client: clients,
      shopHandle: shops.handle,
      currency: shops.currency,
      orderCount: sql<string>`(select count(*) from orders o where o.client_id = clients.id)`,
      spentCents: sql<string>`(select coalesce(sum(o.total_cents - o.refunded_cents), 0) from orders o where o.client_id = clients.id and o.status <> 'cancelled')`,
    })
    .from(clients)
    .innerJoin(shops, eq(shops.id, clients.shopId))
    .orderBy(desc(clients.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    orderCount: num(r.orderCount),
    spentCents: num(r.spentCents),
  }));
}
