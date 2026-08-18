import "server-only";
import { requireStaff } from "@/lib/session";
import { and, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, user } from "@sailo/db/schema";
import { num } from "./pagination";
import { paymentMethods } from "@sailo/db/schema";
import { DAY_MS } from "./pagination";
import type { Shop } from "@sailo/db/schema";

/** Who is paying, when they renew, and which rails sellers actually use. */

export type SubscriptionRow = {
  shop: Shop;
  ownerName: string;
  ownerEmail: string;
};

/**
 * Every account that is paying us, trialling, failing to pay, or comped —
 * everything except the shops that have never been on a paid plan.
 */
export async function getPaidAccounts(): Promise<SubscriptionRow[]> {
  await requireStaff();
  const rows = await getDb()
    .select({ shop: shops, ownerName: user.name, ownerEmail: user.email })
    .from(shops)
    .innerJoin(user, eq(user.id, shops.userId))
    .where(
      or(
        isNotNull(shops.compPlan),
        and(ne(shops.plan, "free"), isNotNull(shops.subscriptionStatus)),
      ),
    )
    .orderBy(desc(shops.currentPeriodEnd));

  return rows;
}

/** Subscriptions renewing inside the window — next month's expected billing. */
export function renewalsWithin(rows: SubscriptionRow[], days = 30) {
  const cutoff = new Date(Date.now() + days * DAY_MS);
  return rows
    .filter(
      (r) =>
        r.shop.currentPeriodEnd &&
        r.shop.currentPeriodEnd <= cutoff &&
        r.shop.currentPeriodEnd >= new Date() &&
        r.shop.subscriptionStatus === "active",
    )
    .toSorted(
      (a, b) =>
        (a.shop.currentPeriodEnd?.getTime() ?? 0) -
        (b.shop.currentPeriodEnd?.getTime() ?? 0),
    );
}

/** How sellers are taking money, across the platform. */
export async function getRailAdoption() {
  await requireStaff();
  const rows = await getDb()
    .select({
      type: paymentMethods.type,
      shops: sql<string>`count(*)`,
      enabled: sql<string>`count(*) filter (where ${paymentMethods.isEnabled})`,
    })
    .from(paymentMethods)
    .groupBy(paymentMethods.type)
    .orderBy(sql`count(*) desc`);

  return rows.map((r) => ({
    type: r.type,
    shops: num(r.shops),
    enabled: num(r.enabled),
  }));
}

/* -------------------------------------------------------------------------- */
/*  Platform-wide lists                                                        */
/* -------------------------------------------------------------------------- */
