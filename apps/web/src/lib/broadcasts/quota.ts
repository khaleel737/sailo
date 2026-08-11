import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { broadcastDeliveries } from "@/db/schema";
import { planFor, type PlanId } from "@/lib/plans";
import type { Shop } from "@/db/schema";

/**
 * How much marketing mail one shop may send in a day, and how much the
 * platform may send in total.
 *
 * Two ceilings, and the second is the one that actually protects anything.
 * Every seller sends through one Resend account and one sending domain, so a
 * single shop mailing a bought list does not damage itself — it damages the
 * deliverability of every other seller's order confirmations. The per-shop
 * limit is a product decision; the platform limit is a shared-resource one.
 *
 * Neither is silent. A send that hits a ceiling stops with the remaining
 * deliveries still `queued` and the broadcast still `sending`, and says how
 * many are left — so tomorrow's tick finishes it and the seller can see why
 * it paused rather than wondering which half of their list got the email.
 */

const PER_PLAN: Record<PlanId, number> = {
  free: 0,
  pro: 0,
  business: 2_000,
};

/**
 * The whole platform's daily budget.
 *
 * Configurable, because the right number is whatever the Resend plan allows
 * and that changes without a deploy. The default is deliberately modest: an
 * over-tight ceiling delays mail and is visible, and an over-loose one gets
 * the sending domain blocked, which is not.
 */
function platformCeiling(): number {
  const raw = Number(process.env.BROADCAST_DAILY_CEILING);
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000;
}

export function dailyAllowance(shop: Pick<Shop, "plan" | "subscriptionStatus"> & {
  compPlan?: string | null;
}): number {
  return PER_PLAN[planFor(shop).id];
}

/** How many this shop has already sent in the last 24 hours. */
export async function sentToday(shopId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [row] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(broadcastDeliveries)
    .where(
      and(
        eq(broadcastDeliveries.shopId, shopId),
        eq(broadcastDeliveries.status, "sent"),
        gte(broadcastDeliveries.sentAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

/** How many the whole platform has sent in the last 24 hours. */
export async function sentTodayPlatform(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [row] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(broadcastDeliveries)
    .where(
      and(
        eq(broadcastDeliveries.status, "sent"),
        gte(broadcastDeliveries.sentAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

export type Budget = {
  /** How many may be sent right now. Zero means "come back later". */
  available: number;
  /** Which ceiling bit, when one did — so the log and the UI can say. */
  limitedBy: "plan" | "platform" | null;
};

export async function budgetFor(
  shop: Pick<Shop, "id" | "plan" | "subscriptionStatus"> & {
    compPlan?: string | null;
  },
  now = new Date(),
): Promise<Budget> {
  const allowance = dailyAllowance(shop);
  if (allowance === 0) return { available: 0, limitedBy: "plan" };

  const [shopSent, platformSent] = await Promise.all([
    sentToday(shop.id, now),
    sentTodayPlatform(now),
  ]);

  const shopLeft = Math.max(0, allowance - shopSent);
  const platformLeft = Math.max(0, platformCeiling() - platformSent);

  const available = Math.min(shopLeft, platformLeft);
  if (available > 0) return { available, limitedBy: null };

  return {
    available: 0,
    limitedBy: shopLeft <= 0 ? "plan" : "platform",
  };
}
