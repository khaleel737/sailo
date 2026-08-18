import "server-only";
import { requireStaff } from "@/lib/session";
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products, shops, user, type Shop } from "@sailo/db/schema";
import { stateFilter } from "./billing-state";
import type { BillingState } from "@/lib/metrics";
import { HQ_PAGE_SIZE, like, num, paginate } from "./pagination";
import { notStaff } from "./roster";
/*
 * Nine reads about one seller's shop, named from the packages that own them
 * rather than through apps/web's `@/lib/queries` barrel — which this app cannot
 * reach, and which was only ever an alias for these anyway.
 */
import { getDashboardStats } from "@sailo/analytics";
import { getRevenueSeries, getVisitSeries } from "@sailo/analytics";
import { listCoupons as getShopCoupons } from "@sailo/commerce/coupons";
import { listDelivery as getShopDeliveryMethods } from "@sailo/commerce/delivery/server";
import {
  getShopAffiliates,
  getShopOrders,
  getShopPaymentMethods,
} from "@sailo/commerce/shop-views";
import { getShopClients } from "@sailo/customers/roster";
import { getAccountSecurity } from "./security";
import { getShopPayments } from "./payments";
import { getStaffLog } from "./system";

/** Every seller, filterable and sortable — and one seller in full. */

export type AccountFilters = {
  q?: string;
  /** A billing state, or "all". */
  state?: string;
  /** onboarded | none | live | unpublished | suspended | connected */
  shopState?: string;
  /** What guards the account: no2fa | cards_no2fa | twofactor | unverified */
  security?: string;
  sort?: string;
  page?: number;
};

export type AccountRow = {
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  joinedAt: Date;
  shop: Shop | null;
  productCount: number;
  orderCount: number;
  gmvCents: number;
  lastOrderAt: Date | null;
};

/*
 * The per-shop aggregates, defined once and used twice — in the select list and
 * again in ORDER BY.
 *
 * Ordering by the output name would be legal Postgres and much tidier, but
 * Drizzle doesn't emit `AS "alias"`: it selects the bare expressions and maps
 * them back to keys in JavaScript. So the database never learns the name, and
 * `order by "gmvCents"` fails with "column does not exist".
 *
 * Note the outer column is written out — `shops.id`, not `${shops.id}`. Drizzle
 * only qualifies a column reference when the query has a join, so in a
 * single-table select the same interpolation renders as a bare `"id"`, which
 * inside the subquery resolves to the *inner* table's id. That doesn't error:
 * it quietly matches nothing and reports zero for everything. It shipped for
 * about an hour and was caught by a screenshot showing a product that had
 * clearly sold two of itself listed as having sold none.
 */
const PRODUCT_COUNT = sql<string>`(select count(*) from products p where p.shop_id = shops.id)`;

const ORDER_COUNT = sql<string>`(select count(*) from orders o where o.shop_id = shops.id)`;

const GMV_CENTS = sql<string>`(
  select coalesce(sum(o.total_cents - o.refunded_cents), 0)
  from orders o
  where o.shop_id = ${shops.id} and o.status <> 'cancelled'
)`;

const LAST_ORDER_AT = sql<
  string | null
>`(select max(o.created_at) from orders o where o.shop_id = shops.id)`;

const ACCOUNT_SORTS = {
  newest: desc(user.createdAt),
  oldest: asc(user.createdAt),
  gmv: desc(GMV_CENTS),
  orders: desc(ORDER_COUNT),
  products: desc(PRODUCT_COUNT),
  // Accounts that never sold anything belong at the bottom of "recently
  // active", not the top, which is where a null would sort by default.
  active: sql`${LAST_ORDER_AT} desc nulls last`,
} satisfies Record<string, SQL>;

function accountSort(key: string | undefined): SQL {
  return key && key in ACCOUNT_SORTS
    ? ACCOUNT_SORTS[key as keyof typeof ACCOUNT_SORTS]
    : ACCOUNT_SORTS.newest;
}

export const ACCOUNT_SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "gmv", label: "Highest volume" },
  { value: "orders", label: "Most orders" },
  { value: "products", label: "Most products" },
  { value: "active", label: "Recently active" },
] as const;

function accountWhere(filters: AccountFilters): SQL | undefined {
  const clauses: (SQL | undefined)[] = [];

  if (filters.q?.trim()) {
    const pattern = like(filters.q);
    clauses.push(
      or(
        ilike(user.name, pattern),
        ilike(user.email, pattern),
        ilike(shops.name, pattern),
        ilike(shops.handle, pattern),
      ),
    );
  }

  if (filters.state && filters.state !== "all") {
    clauses.push(stateFilter(filters.state as BillingState));
  }

  switch (filters.shopState) {
    case "onboarded":
      clauses.push(isNotNull(shops.id));
      break;
    case "none":
      clauses.push(isNull(shops.id));
      break;
    case "live":
      // A tombstoned shop is unpublished and not suspended, so without the
      // third clause it would have counted as live here.
      clauses.push(
        and(
          eq(shops.isPublished, true),
          isNull(shops.suspendedAt),
          isNull(shops.deletedAt),
        ),
      );
      break;
    case "unpublished":
      clauses.push(and(eq(shops.isPublished, false), isNull(shops.deletedAt)));
      break;
    case "suspended":
      clauses.push(isNotNull(shops.suspendedAt));
      break;
    case "deleted":
      clauses.push(isNotNull(shops.deletedAt));
      break;
    case "connected":
      clauses.push(eq(shops.stripeChargesEnabled, true));
      break;
    default:
      break;
  }

  /*
   * The security filters, so the answer to "who is exposed" is a list you can
   * work rather than a number on a dashboard. `cards_no2fa` is the one that
   * matters most and is deliberately its own option rather than two filters
   * combined by hand: a shop taking card payments behind a single password is
   * a different sentence from a shop with no second factor and nothing to
   * steal, and the difference is what decides whether you email them today.
   */
  switch (filters.security) {
    case "no2fa":
      clauses.push(eq(user.twoFactorEnabled, false));
      break;
    case "cards_no2fa":
      clauses.push(
        and(eq(shops.stripeChargesEnabled, true), eq(user.twoFactorEnabled, false)),
      );
      break;
    case "twofactor":
      clauses.push(eq(user.twoFactorEnabled, true));
      break;
    case "unverified":
      clauses.push(eq(user.emailVerified, false));
      break;
    default:
      break;
  }

  const present = clauses.filter(Boolean);
  return present.length > 0 ? and(...present) : undefined;
}

/**
 * One page of accounts — every registered user, with the shop they own if they
 * ever finished onboarding, and the numbers that say whether it went anywhere.
 *
 * A left join, not an inner one: someone who signed up and never created a
 * shop is exactly the account we most need to see.
 */
export async function getAccounts(filters: AccountFilters = {}) {
  await requireStaff();
  const db = getDb();
  // Customers only: the staff account is a user like any other, but it is not
  // an account we acquired, so it has no place in a list of them.
  const where = and(notStaff(), accountWhere(filters));

  const result = await paginate(
    filters.page ?? 1,
    (offset) =>
      db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          twoFactorEnabled: user.twoFactorEnabled,
          joinedAt: user.createdAt,
          shop: shops,
          productCount: PRODUCT_COUNT,
          orderCount: ORDER_COUNT,
          gmvCents: GMV_CENTS,
          lastOrderAt: LAST_ORDER_AT,
        })
        .from(user)
        .leftJoin(shops, eq(shops.userId, user.id))
        .where(where)
        .orderBy(accountSort(filters.sort))
        .limit(HQ_PAGE_SIZE)
        .offset(offset),

    async () => {
      const [totals] = await db
        .select({ n: sql<string>`count(*)` })
        .from(user)
        .leftJoin(shops, eq(shops.userId, user.id))
        .where(where);
      return num(totals?.n);
    },
  );

  return {
    ...result,
    rows: result.rows.map(
      (r): AccountRow => ({
        userId: r.userId,
        name: r.name,
        email: r.email,
        emailVerified: r.emailVerified,
        twoFactorEnabled: r.twoFactorEnabled,
        joinedAt: r.joinedAt,
        shop: r.shop,
        productCount: num(r.productCount),
        orderCount: num(r.orderCount),
        gmvCents: num(r.gmvCents),
        lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt) : null,
      }),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/*  One account, a tab at a time                                               */
/* -------------------------------------------------------------------------- */

/**
 * WHY THIS IS FIVE FUNCTIONS AND NOT ONE
 *
 * It was one, called `getAccountDetail`, and it fired thirteen queries in
 * parallel on every visit to an account: the dashboard stats, two chart series,
 * the orders, the catalogue, the affiliates, every buyer, the payment rails,
 * the delivery options, the coupons, five scalar counts, the security picture
 * and the staff log. Then it rendered all of it into a 605-line page that
 * nobody scrolled to the bottom of.
 *
 * The page is now five routes — overview, commerce, money, risk, security — and
 * the split is a database decision as much as a layout one. Somebody opening an
 * account to check a plan pays for the plan; somebody who genuinely needs every
 * buyer this shop has ever had asks for that tab and pays for it then. The
 * common case went from thirteen queries to four.
 *
 * `getAccountHeader` is the one every tab needs, and it is deliberately small:
 * the owner, the shop, and nothing else. It is called once per request by the
 * layout and again by the page, which costs one round trip rather than two —
 * `requireStaff` is request-cached and Postgres will have this row in memory —
 * and it means a tab can be linked to directly without the layout having to
 * hand it down through props it does not own.
 */

/** The owner and their shop. What every tab needs and no tab is built from. */
export async function getAccountHeader(userId: string) {
  await requireStaff();
  const db = getDb();

  const owner = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!owner) return null;

  const shop = await db.query.shops.findFirst({
    where: eq(shops.userId, owner.id),
  });

  return { owner, shop: shop ?? null } as const;
}

/**
 * The overview tab: is this shop working, and what have we done to it.
 *
 * Four reads. The two chart series and the dashboard stats are what the tab is
 * for; the staff log is here rather than on its own tab because "what did we do
 * to this account" is the question somebody is holding when they arrive, and
 * putting it a click away means they arrive at the wrong answer first.
 */
export async function getAccountOverview(shopId: string) {
  await requireStaff();

  const [stats, visitSeries, revenueSeries, log] = await Promise.all([
    getDashboardStats(shopId, 30),
    getVisitSeries(shopId, 30),
    getRevenueSeries(shopId, 30),
    getStaffLog({ shopId, limit: 20 }),
  ]);

  return { stats, visitSeries, revenueSeries, log } as const;
}

/** The commerce tab: what this shop sells, to whom, and how it takes the money. */
export async function getAccountCommerce(shopId: string) {
  await requireStaff();
  const db = getDb();

  const [
    recentOrders,
    catalogue,
    shopAffiliates,
    buyers,
    payments,
    delivery,
    shopCoupons,
    [extras],
  ] = await Promise.all([
    /*
     * Ten, not twenty-five. This tab exists to answer "is this a real
     * business", and twenty-five rows of orders pushed the catalogue, the
     * affiliates and the buyers a thousand pixels below the fold — so the tab
     * became an orders list with three tables hidden under it. The full history
     * is one click away on /orders, which is the screen built for it.
     */
    getShopOrders(shopId, 10),
    getShopProductRows(shopId, 25),
    getShopAffiliates(shopId),
    /*
     * Every buyer, deliberately. The default cap is a safety valve for the
     * seller's own admin; here the number is *reported* as the shop's buyer
     * count, and a capped list reported as a total is a wrong number on a
     * staff screen used to make decisions about that shop.
     */
    getShopClients(shopId, null),
    getShopPaymentMethods(shopId),
    getShopDeliveryMethods(shopId),
    getShopCoupons(shopId),
    db
      .select({
        invoices: sql<string>`(select count(*) from invoices i where i.shop_id = ${shopId})`,
        reviews: sql<string>`(select count(*) from reviews r where r.shop_id = ${shopId})`,
        categories: sql<string>`(select count(*) from categories c where c.shop_id = ${shopId})`,
      })
      .from(shops)
      .where(eq(shops.id, shopId)),
  ]);

  return {
    recentOrders,
    catalogue,
    affiliates: shopAffiliates,
    buyers: buyers.slice(0, 25),
    buyerCount: buyers.length,
    payments,
    delivery,
    coupons: shopCoupons,
    invoiceCount: num(extras?.invoices),
    reviewCount: num(extras?.reviews),
    categoryCount: num(extras?.categories),
  } as const;
}

/** The money tab: what they pay us, what Stripe says, and every payment taken. */
export async function getAccountMoney(shopId: string) {
  await requireStaff();
  const db = getDb();

  const [payments, [extras]] = await Promise.all([
    getShopPayments(shopId, 30),
    db
      .select({
        firstOrderAt: sql<Date | null>`(select min(o.created_at) from orders o where o.shop_id = ${shopId})`,
        lastOrderAt: sql<Date | null>`(select max(o.created_at) from orders o where o.shop_id = ${shopId})`,
        grossCents: sql<string>`(select coalesce(sum(o.total_cents), 0) from orders o where o.shop_id = ${shopId} and o.status <> 'cancelled')`,
        refundedCents: sql<string>`(select coalesce(sum(o.refunded_cents), 0) from orders o where o.shop_id = ${shopId})`,
        invoices: sql<string>`(select count(*) from invoices i where i.shop_id = ${shopId})`,
      })
      .from(shops)
      .where(eq(shops.id, shopId)),
  ]);

  return {
    payments,
    firstOrderAt: extras?.firstOrderAt ? new Date(extras.firstOrderAt) : null,
    lastOrderAt: extras?.lastOrderAt ? new Date(extras.lastOrderAt) : null,
    grossCents: num(extras?.grossCents),
    refundedCents: num(extras?.refundedCents),
    invoiceCount: num(extras?.invoices),
  } as const;
}

/**
 * The security tab, for an account with or without a shop.
 *
 * Thin on purpose — `getAccountSecurity` in `./security` is the whole of it.
 * Wrapped anyway so every tab is reached the same way and the page does not
 * have to know which module its data lives in.
 */
export async function getAccountSecurityTab(userId: string, shopId: string | null) {
  await requireStaff();
  return getAccountSecurity(userId, shopId);
}

export type ShopProductRow = {
  id: string;
  title: string;
  slug: string;
  kind: string;
  priceCents: number;
  isPublished: boolean;
  inStock: boolean;
  stockQuantity: number | null;
  createdAt: Date;
  orderCount: number;
};

/** A shop's catalogue, light — no images or variants, just what a table shows. */
async function getShopProductRows(shopId: string, limit = 12) {
  const rows = await getDb()
    .select({
      id: products.id,
      title: products.title,
      slug: products.slug,
      kind: products.kind,
      priceCents: products.priceCents,
      isPublished: products.isPublished,
      inStock: products.inStock,
      stockQuantity: products.stockQuantity,
      createdAt: products.createdAt,
      orderCount: sql<string>`(select count(*) from order_items oi where oi.product_id = products.id)`,
    })
    .from(products)
    .where(eq(products.shopId, shopId))
    .orderBy(desc(products.createdAt))
    .limit(limit);

  return rows.map(
    (r): ShopProductRow => ({ ...r, orderCount: num(r.orderCount) }),
  );
}

/* -------------------------------------------------------------------------- */
/*  Subscriptions                                                              */
/* -------------------------------------------------------------------------- */
