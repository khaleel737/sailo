import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { broadcastDeliveries } from "@sailo/db/schema";
import { planFor, type PlanId } from "@sailo/core/plans";
import type { Shop } from "@sailo/db/schema";

/**
 * How much marketing mail one shop may send in a day, and how much the
 * platform may send in total.
 *
 * Four ceilings now, and only the first is a product decision. Every seller
 * sends through one Resend account and one sending domain, so a single shop
 * mailing a bought list does not damage itself — it damages the deliverability
 * of every other seller's order confirmations. The plan allowance is what a
 * seller bought; the platform ceiling, the warm-up ramp and the reputation
 * pause are all the same shared resource being protected from three different
 * ways of losing it.
 *
 * They compose here and only here, because this is the one function every
 * marketing send already asks before it sends anything. A second gate
 * somewhere else would be a second thing to keep in step with this one.
 *
 * None of them is silent. A send that hits a ceiling stops with the remaining
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

/**
 * The ramp a brand-new shop climbs before it may send its full allowance.
 *
 * Two things it buys, and the second is the one that pays for it.
 *
 * Mailbox providers score a *sending domain* on volume history: two thousand
 * messages on day one from an address nobody has ever received mail from is
 * the exact shape of a spam run, and it is scored as one. Ramping is the
 * standard answer, and here the domain is shared, so a new shop's first send
 * is spending everyone else's reputation.
 *
 * And it is what makes the reputation pause reachable. Abuse is front-loaded —
 * somebody who signed up to mail a bought list does it immediately — and
 * `evaluateShop` cannot pause anybody until 100 messages have gone out and the
 * bounces have come back. Without a ramp, that verdict lands after a shop has
 * already sent two thousand. The ramp is the time the measurement needs.
 *
 * Each step is the ceiling *through* that day of the shop's life; past the
 * last one the ramp is over and the plan allowance stands alone.
 */
const WARM_UP: readonly { readonly throughDay: number; readonly cap: number }[] = [
  { throughDay: 2, cap: 100 },
  { throughDay: 6, cap: 500 },
  { throughDay: 13, cap: 1_000 },
];

/**
 * The warm-up ceiling for a shop this old, or null once it is past the ramp.
 *
 * Null rather than `Infinity` so the caller can say *which* ceiling bit: a
 * warmed-up shop that runs out of allowance has hit its plan limit, and
 * telling that seller they are "still warming up" would be a lie they cannot
 * do anything about.
 */
export function warmUpCeiling(createdAt: Date, now = new Date()): number | null {
  // Clock skew, or a seeded row dated in the future: day zero, not a negative
  // day that would fall through the table and read as fully warmed up.
  const age = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000));
  return WARM_UP.find((step) => age <= step.throughDay)?.cap ?? null;
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
  /**
   * Which ceiling bit, when one did — so the log and the UI can say.
   *
   * `paused` is the one that does not resolve itself by waiting: the other
   * three roll with the window or with the calendar, and that one waits for a
   * person. Anything rendering this to a seller has to say so.
   */
  limitedBy: "plan" | "platform" | "warmup" | "paused" | null;
};

export async function budgetFor(
  shop: Pick<
    Shop,
    "id" | "plan" | "subscriptionStatus" | "createdAt" | "marketingPausedAt"
  > & {
    compPlan?: string | null;
  },
  now = new Date(),
): Promise<Budget> {
  /*
   * First, and without asking the database anything. A shop paused for its
   * complaint rate is not "over today's quota" — there is no amount of waiting
   * that makes it sendable, and the counting below would be answering a
   * question nobody asked.
   */
  if (shop.marketingPausedAt) return { available: 0, limitedBy: "paused" };

  const planAllowance = dailyAllowance(shop);
  if (planAllowance === 0) return { available: 0, limitedBy: "plan" };

  const warmUp = warmUpCeiling(shop.createdAt, now);
  const allowance = warmUp === null ? planAllowance : Math.min(planAllowance, warmUp);

  const [shopSent, platformSent] = await Promise.all([
    sentToday(shop.id, now),
    sentTodayPlatform(now),
  ]);

  const shopLeft = Math.max(0, allowance - shopSent);
  const platformLeft = Math.max(0, platformCeiling() - platformSent);

  const available = Math.min(shopLeft, platformLeft);
  if (available > 0) return { available, limitedBy: null };

  /*
   * Which of the two shop-side ceilings to name. The ramp is only the honest
   * answer when it is actually the binding one — a warming-up shop on a plan
   * whose allowance is *lower* than today's ramp step has hit the plan.
   */
  if (shopLeft > 0) return { available: 0, limitedBy: "platform" };
  return {
    available: 0,
    limitedBy: warmUp !== null && warmUp < planAllowance ? "warmup" : "plan",
  };
}
