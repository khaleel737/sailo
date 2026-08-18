import "server-only";
import { requireStaff } from "@/lib/session";
import { desc, eq, sql } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import {
  affiliates,
  clients,
  marketingOptOuts,
  newsletterSubscribers,
  orders,
  products,
  shops,
  user,
} from "@sailo/db/schema";
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
      // The column the "mail every seller who hasn't turned 2FA on" merge is
      // filtered by — which is the whole point of measuring adoption.
      twoFactorEnabled: user.twoFactorEnabled,
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

/**
 * Sailo's own mailing list, whole.
 *
 * The one export whose rows are people who never became customers, and the
 * reason it exists is the two columns a screen cannot sort by usefully: which
 * page won them, and whether they went on to sign up. That pair is the entire
 * argument for writing the blog, and it is a question answered in a
 * spreadsheet rather than in a table of twenty-five rows.
 *
 * The opt-out is joined and reported rather than filtered. An export that
 * silently dropped everyone who left would be handed to somebody as "the
 * list", and the gap between it and the count on the overview would read as a
 * bug in one of them.
 */
export async function getAllSubscribersForExport(limit = 50000) {
  await requireStaff();
  return getReadDb()
    .select({
      email: newsletterSubscribers.email,
      name: newsletterSubscribers.name,
      locale: newsletterSubscribers.locale,
      source: newsletterSubscribers.source,
      sourcePath: newsletterSubscribers.sourcePath,
      confirmedAt: newsletterSubscribers.confirmedAt,
      optedOutReason: marketingOptOuts.reason,
      optedOutAt: marketingOptOuts.createdAt,
      /*
       * Folded on both sides. `user.email` is stored as the person typed it
       * and this table stores lowercase, so a raw comparison would file every
       * seller who capitalised their address as somebody who never signed up —
       * which would understate the one number this export exists to produce.
       */
      hasAccount: sql<boolean>`exists (
        select 1 from ${user} u
        where lower(u.email) = ${newsletterSubscribers.email}
      )`,
    })
    .from(newsletterSubscribers)
    .leftJoin(
      marketingOptOuts,
      sql`${marketingOptOuts.email} = ${newsletterSubscribers.email}`,
    )
    .orderBy(desc(newsletterSubscribers.confirmedAt))
    .limit(limit);
}
