import "server-only";
import { requireStaff } from "@/lib/session";
import type { PgTable } from "drizzle-orm/pg-core";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { invoices, orders, reviews, shops, staffActions, stripeEvents, user, visits } from "@sailo/db/schema";
import { DAY_MS, num } from "./pagination";
import { affiliates, clients, coupons, products, visitDaily } from "@sailo/db/schema";

/** The staff audit trail, and whether the platform itself is healthy. */

export async function getStaffLog({
  shopId,
  limit = 40,
}: { shopId?: string; limit?: number } = {}) {
  await requireStaff();
  return getDb()
    .select({
      id: staffActions.id,
      actorEmail: staffActions.actorEmail,
      action: staffActions.action,
      summary: staffActions.summary,
      createdAt: staffActions.createdAt,
      shopId: staffActions.shopId,
      shopName: shops.name,
      shopHandle: shops.handle,
      ownerId: shops.userId,
    })
    .from(staffActions)
    .leftJoin(shops, eq(shops.id, staffActions.shopId))
    .where(shopId ? eq(staffActions.shopId, shopId) : undefined)
    .orderBy(desc(staffActions.createdAt))
    .limit(limit);
}

/* -------------------------------------------------------------------------- */
/*  System                                                                     */
/* -------------------------------------------------------------------------- */

/** Reports only whether an environment variable is set — never its value. */
function flag(name: string, key: string, detail?: string) {
  return { name, ok: Boolean(process.env[key]), detail };
}

/**
 * What the platform is wired to, and whether the machinery ran.
 *
 * Only ever reports whether a secret is *present*. Nothing here prints a key,
 * a token or any part of one — this page is one leaked screenshot away from
 * being a very bad day.
 */
export async function getSystemHealth() {
  await requireStaff();
  const db = getDb();

  const priceKeys = [
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_PRICE_PRO_YEARLY",
    "STRIPE_PRICE_BUSINESS_MONTHLY",
    "STRIPE_PRICE_BUSINESS_YEARLY",
  ];
  const missingPrices = priceKeys.filter((key) => !process.env[key]);

  /*
   * One count per table, in parallel. A single query with ten scalar
   * subqueries would need a FROM to hang them off, and every candidate table
   * can be empty — which would return no row at all and report the whole
   * platform as zero.
   */
  const countOf = async (table: PgTable) => {
    const [row] = await db.select({ n: sql<string>`count(*)` }).from(table);
    return num(row?.n);
  };

  const [
    [rollup],
    [events],
    [lastEvent],
    users,
    shopCount,
    productCount,
    orderCount,
    clientCount,
    affiliateCount,
    invoiceCount,
    reviewCount,
    couponCount,
    visitCount,
  ] = await Promise.all([
    db
      .select({
        through: sql<string | null>`max(${visitDaily.day})`,
        rows: sql<string>`count(*)`,
      })
      .from(visitDaily),
    db.select({ n: sql<string>`count(*)` }).from(stripeEvents),
    db
      .select({
        type: stripeEvents.type,
        at: stripeEvents.processedAt,
      })
      .from(stripeEvents)
      .orderBy(desc(stripeEvents.processedAt))
      .limit(1),
    countOf(user),
    countOf(shops),
    countOf(products),
    countOf(orders),
    countOf(clients),
    countOf(affiliates),
    countOf(invoices),
    countOf(reviews),
    countOf(coupons),
    countOf(visits),
  ]);

  return {
    integrations: [
      flag("Database", "DATABASE_URL", "Neon Postgres"),
      flag("Auth secret", "BETTER_AUTH_SECRET"),
      flag("App URL", "NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL),
      flag("Stripe billing", "STRIPE_SECRET_KEY", "Subscriptions"),
      flag("Stripe webhook", "STRIPE_WEBHOOK_SECRET", "Plan changes land here"),
      flag(
        "Stripe Connect",
        "STRIPE_PLATFORM_ACCOUNT_ID",
        "Card payments for sellers",
      ),
      {
        name: "Plan prices",
        ok: missingPrices.length === 0,
        detail:
          missingPrices.length === 0
            ? "All four configured"
            : `Missing: ${missingPrices.join(", ")}`,
      },
      flag("Email", "RESEND_API_KEY", "Order and invoice mail"),
      flag("File storage", "BLOB_READ_WRITE_TOKEN", "Product images and files"),
      { name: "Redis", ok: Boolean(process.env.REDIS_URL), detail: "Optional — rate limiting" },
      flag("Cron secret", "CRON_SECRET", "Guards the nightly rollup"),
    ],
    tables: [
      { name: "Accounts", n: users },
      { name: "Shops", n: shopCount },
      { name: "Products", n: productCount },
      { name: "Orders", n: orderCount },
      { name: "Buyers", n: clientCount },
      { name: "Affiliates", n: affiliateCount },
      { name: "Invoices", n: invoiceCount },
      { name: "Reviews", n: reviewCount },
      { name: "Coupons", n: couponCount },
      { name: "Pageviews", n: visitCount },
    ],
    rollup: {
      through: rollup?.through ? new Date(rollup.through) : null,
      rows: num(rollup?.rows),
      /*
       * Whole days between the last folded day and now, worked out here rather
       * than in the page. A component that reads the clock renders differently
       * every time it is called, which React is right to object to.
       */
      daysBehind: rollup?.through
        ? Math.floor((Date.now() - new Date(rollup.through).getTime()) / DAY_MS)
        : null,
    },
    stripeEvents: {
      total: num(events?.n),
      lastType: lastEvent?.type ?? null,
      lastAt: lastEvent?.at ?? null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Exports                                                                    */
/* -------------------------------------------------------------------------- */
