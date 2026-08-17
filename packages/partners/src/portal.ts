import "server-only";
import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { affiliates, orders, shops, type Affiliate, type Shop } from "@sailo/db/schema";
import { randomHex } from "@sailo/core/token";

/**
 * The affiliate's own view of what they've earned.
 *
 * Affiliates have no account — they're someone's friend with a link, not a
 * user of the product — so the report is reached by an unguessable token
 * rather than a password. The token is separate from `code`, which appears in
 * every link they share and is therefore public by design.
 */

export function newPortalToken() {
  return randomHex(18);
}

/** Issues a token the first time one is needed, and keeps it thereafter. */
export async function ensurePortalToken(affiliate: Affiliate): Promise<string> {
  if (affiliate.portalToken) return affiliate.portalToken;

  const token = newPortalToken();
  await getDb()
    .update(affiliates)
    .set({ portalToken: token, updatedAt: new Date() })
    .where(eq(affiliates.id, affiliate.id));
  return token;
}

export function portalUrl(token: string, base = process.env.NEXT_PUBLIC_APP_URL) {
  return `${base ?? ""}/partner/${token}`;
}

export type PortalStats = {
  clicks: number;
  orderCount: number;
  /** Orders that weren't cancelled, at their full value. */
  salesCents: number;
  earnedCents: number;
  paidCents: number;
  unpaidCents: number;
  /** Orders per click, as a percentage. Null when nobody has clicked yet. */
  conversion: number | null;
  /** What the seller pays out on, per order. */
  commissionBp: number;
};

export type PortalOrder = {
  id: string;
  createdAt: Date;
  productTitle: string;
  itemCount: number;
  totalCents: number;
  commissionCents: number;
  commissionPaid: boolean;
  status: string;
  currency: string;
};

/** One shop this person promotes, for the switcher. */
export type PortalShop = {
  token: string;
  shopName: string;
  handle: string;
  currency: string;
  earnedCents: number;
  unpaidCents: number;
  isCurrent: boolean;
};

async function statsFor(affiliate: Affiliate, shop: Shop): Promise<PortalStats> {
  const [row] = await getDb()
    .select({
      orderCount: sql<string>`count(*)`,
      // A cancelled order was never a sale, so it isn't one here either.
      sales: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      earned: sql<string>`coalesce(sum(${orders.commissionCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      paid: sql<string>`coalesce(sum(${orders.commissionCents}) filter (where ${orders.commissionPaid}), 0)`,
      unpaid: sql<string>`coalesce(sum(${orders.commissionCents}) filter (where not ${orders.commissionPaid} and ${orders.status} <> 'cancelled'), 0)`,
    })
    .from(orders)
    .where(eq(orders.affiliateId, affiliate.id));

  const orderCount = Number(row?.orderCount ?? 0);

  return {
    clicks: affiliate.clicks,
    orderCount,
    salesCents: Number(row?.sales ?? 0),
    earnedCents: Number(row?.earned ?? 0),
    paidCents: Number(row?.paid ?? 0),
    unpaidCents: Number(row?.unpaid ?? 0),
    conversion: affiliate.clicks > 0 ? (orderCount / affiliate.clicks) * 100 : null,
    commissionBp: affiliate.commissionBp ?? shop.affiliateDefaultBp,
  };
}

/**
 * Orders and commission by day, zero-filled so the chart has a shape even in a
 * quiet week. UTC buckets, to match how Postgres truncates.
 */
async function seriesFor(affiliateId: string, days = 30) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${orders.createdAt}::date, 'YYYY-MM-DD')`,
      orders: sql<string>`count(*)`,
      commission: sql<string>`coalesce(sum(${orders.commissionCents}), 0)`,
    })
    .from(orders)
    .where(
      and(eq(orders.affiliateId, affiliateId), gte(orders.createdAt, since)),
    )
    .groupBy(sql`${orders.createdAt}::date`)
    .orderBy(sql`${orders.createdAt}::date`);

  const byDay = new Map(
    rows.map((r) => [r.day, { orders: Number(r.orders), commission: Number(r.commission) }]),
  );

  const out: { day: string; orders: number; commissionCents: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const hit = byDay.get(key);
    out.push({ day: key, orders: hit?.orders ?? 0, commissionCents: hit?.commission ?? 0 });
  }
  return out;
}

/**
 * Every shop this person is an affiliate for, matched on their email.
 *
 * This is the answer to "how do I see my commission across stores": one link
 * opens the report, and the report knows about the rest.
 */
async function shopsForEmail(
  email: string | null,
  currentId: string,
): Promise<PortalShop[]> {
  if (!email) return [];
  const db = getDb();

  const rows = await db
    .select({
      affiliate: affiliates,
      shop: shops,
      earned: sql<string>`coalesce(sum(${orders.commissionCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      unpaid: sql<string>`coalesce(sum(${orders.commissionCents}) filter (where not ${orders.commissionPaid} and ${orders.status} <> 'cancelled'), 0)`,
    })
    .from(affiliates)
    .innerJoin(shops, eq(shops.id, affiliates.shopId))
    .leftJoin(orders, eq(orders.affiliateId, affiliates.id))
    .where(and(eq(affiliates.email, email), eq(affiliates.status, "active")))
    .groupBy(affiliates.id, shops.id)
    .orderBy(desc(sql`coalesce(sum(${orders.commissionCents}), 0)`));

  const out: PortalShop[] = [];
  for (const row of rows) {
    // A sibling shop needs its own token before it can be linked to.
    const token = await ensurePortalToken(row.affiliate);
    out.push({
      token,
      shopName: row.shop.name,
      handle: row.shop.handle,
      currency: row.shop.currency,
      earnedCents: Number(row.earned),
      unpaidCents: Number(row.unpaid),
      isCurrent: row.affiliate.id === currentId,
    });
  }
  return out;
}

export async function getPortalByToken(token: string) {
  const db = getDb();

  const affiliate = await db.query.affiliates.findFirst({
    where: eq(affiliates.portalToken, token),
  });
  if (!affiliate) return null;

  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, affiliate.shopId),
  });
  if (!shop) return null;

  const recent = await db.query.orders.findMany({
    where: eq(orders.affiliateId, affiliate.id),
    orderBy: [desc(orders.createdAt)],
    limit: 20,
  });

  const [stats, series, siblings] = await Promise.all([
    statsFor(affiliate, shop),
    seriesFor(affiliate.id),
    shopsForEmail(affiliate.email, affiliate.id),
  ]);

  // Best effort — knowing whether a partner has ever opened their report is
  // useful to the seller, and not worth failing the page over.
  db.update(affiliates)
    .set({ portalSeenAt: new Date() })
    .where(eq(affiliates.id, affiliate.id))
    .catch(() => {});

  const recentOrders: PortalOrder[] = recent.map((o) => ({
    id: o.id,
    createdAt: o.createdAt,
    productTitle: o.productTitle,
    itemCount: o.itemCount,
    totalCents: o.totalCents,
    commissionCents: o.commissionCents,
    commissionPaid: o.commissionPaid,
    status: o.status,
    currency: o.currency,
  }));

  return { affiliate, shop, stats, series, recentOrders, siblings };
}

/**
 * The links for an email address, across every shop that person promotes.
 * Returns an empty list for an unknown address rather than saying so — the
 * form must not become a way to test whether someone is an affiliate.
 */
export async function portalLinksForEmail(email: string) {
  const db = getDb();
  const rows = await db
    .select({ affiliate: affiliates, shop: shops })
    .from(affiliates)
    .innerJoin(shops, eq(shops.id, affiliates.shopId))
    .where(
      and(
        eq(affiliates.email, email.trim().toLowerCase()),
        eq(affiliates.status, "active"),
        isNotNull(affiliates.email),
      ),
    )
    .orderBy(asc(shops.name));

  const links: { shopName: string; url: string }[] = [];
  for (const row of rows) {
    const token = await ensurePortalToken(row.affiliate);
    links.push({ shopName: row.shop.name, url: portalUrl(token) });
  }
  return links;
}
