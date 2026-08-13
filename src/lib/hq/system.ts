import "server-only";
import { requireStaff } from "@/lib/session";
import type { PgTable } from "drizzle-orm/pg-core";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { invoices, orders, reviews, shops, staffActions, stripeEvents, user, visits } from "@/db/schema";
import { DAY_MS, num } from "./pagination";
import { readLastCheck } from "@/lib/blocklist/state";
import { affiliates, clients, coupons, products, visitDaily } from "@/db/schema";

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
 * The daily blocklist check, reported rather than performed.
 *
 * This page must not run the DNS queries itself: the zones throttle, and a
 * staff member refreshing HQ would spend the day's quota on a question that was
 * already answered at 04:42. So it reads what the cron recorded, and says
 * plainly when there is nothing to read.
 *
 * Not-ok covers three different situations on purpose — listed, never
 * recorded, and recorded too long ago — because they share the only response
 * that matters here: do not assume the sending domains are clean.
 */
function blocklistFlag(last: Awaited<ReturnType<typeof readLastCheck>>) {
  const name = "Domain blocklists";
  if (!last) {
    return {
      name,
      ok: false,
      detail: "No result recorded — needs REDIS_URL and a cron run",
    };
  }

  const when = new Date(last.at);
  const stale = Date.now() - when.getTime() > 2 * DAY_MS;
  const on = when.toISOString().replace("T", " ").slice(0, 16);

  if (last.listings.length > 0) {
    const which = last.listings
      .map((listing) => `${listing.domain} on ${listing.label} (${listing.code})`)
      .join("; ");
    return { name, ok: false, detail: `LISTED — ${which}` };
  }

  return {
    name,
    ok: !stale,
    detail: stale
      ? `Last checked ${on} UTC — the daily job may have stopped`
      : `Clear as of ${on} UTC`,
  };
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
    lastBlocklistCheck,
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
    // Redis, not Postgres — and it fails to null rather than throwing, so a
    // cold cache costs this one line of the page and nothing else.
    readLastCheck(),
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
      /*
       * The two sending domains, which nothing else in this panel reported.
       * Unset is not a fault — both fall back to the brand domain — but it is
       * the state in which a marketing complaint can blocklist the domain the
       * *website* answers on, so it should be visible rather than implicit.
       */
      flag(
        "Transactional domain",
        "SAILO_TX_DOMAIN",
        process.env.SAILO_TX_DOMAIN ?? "Unset — receipts send from the brand domain",
      ),
      flag(
        "Marketing domain",
        "SAILO_MKT_DOMAIN",
        process.env.SAILO_MKT_DOMAIN ?? "Unset — campaigns send from the brand domain",
      ),
      blocklistFlag(lastBlocklistCheck),
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
