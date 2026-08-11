import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  lifecycleEmails,
  marketingOptOuts,
  orders,
  paymentMethods,
  products,
  shops,
  user,
  type ShopSocial,
} from "@/db/schema";
import { RETIRED_STEP } from "./steps";

/**
 * Where a seller actually stands, derived from the rows that already exist.
 *
 * Nothing here is stored. The funnel position is a *reading* of the shop,
 * product, payment-rail and order tables, exactly as the dashboard's setup
 * checklist reads them — and for the same reason. A stored `stage` column
 * would be a second answer to a question the data already answers, and the
 * two come apart the first time a seller deletes their only product or
 * switches their last rail off. Deriving also means the pipeline was already
 * correct for every seller who signed up before it existed: no backfill, no
 * migration of state, nothing to replay.
 *
 * One query builds this for a whole tick's worth of candidates. Doing it per
 * user would be five round trips each, and on Neon's HTTP driver that is five
 * requests each.
 */

export type LifecycleShop = {
  id: string;
  handle: string;
  name: string;
  createdAt: Date;
  plan: string;
  subscriptionStatus: string | null;
  compPlan: string | null;
  avatarUrl: string | null;
  logoUrl: string | null;
  socials: ShopSocial[];
  stripeChargesEnabled: boolean;
};

export type LifecycleState = {
  userId: string;
  email: string;
  name: string;
  /** Proof the address is really theirs — see `requiresVerifiedEmail`. */
  emailVerified: boolean;
  signedUpAt: Date;

  /** Null while they have signed up and built nothing. The first branch. */
  shop: LifecycleShop | null;

  productCount: number;
  /** When the catalogue started. The anchor for the "get paid" branch. */
  firstProductAt: Date | null;
  /** Enabled rows in `payment_methods` — cash and chat rails count. */
  railCount: number;
  /** Orders that still stand: cancelled and refunded ones are not traction. */
  orderCount: number;
  firstOrderAt: Date | null;

  /** Steps already claimed for this user, sent or failed. */
  sent: Set<string>;
  /** When we last wrote to them at all, for the pacing gate. */
  lastLifecycleAt: Date | null;
};

/**
 * How far back a pass will look.
 *
 * A bound is needed — without one this reads every user who ever signed up,
 * once an hour, forever — and signup age is the honest one to bound on,
 * because every anchor in the ladder except the first-order ones is a fixed
 * offset from it. Six months is well past the last rung for anybody following
 * the pipeline at a normal pace, and a seller whose first sale lands later
 * than that is a seller the upgrade nudge has nothing useful to say to.
 *
 * It is deliberately not "users with fewer than N steps claimed". That reads
 * the whole table to compute the exclusion, which is the cost this is
 * avoiding.
 */
export const CANDIDATE_WINDOW_DAYS = 180;

/**
 * How recently a tombstoned account must have built a shop to be reconsidered.
 *
 * Comfortably longer than `shop_live`'s own staleness, so the revival cannot
 * be the thing that makes a rung unreachable — a seller who returns and
 * builds a shop is back in the pipeline well before any rung anchored on that
 * shop has expired.
 */
const REVIVAL_WINDOW_DAYS = 45;

/**
 * The sellers a tick will consider, newest signups last.
 *
 * Four filters live in the WHERE rather than in the loop, because each one is
 * a reason to never mail somebody and a filter applied later is a filter some
 * future call site forgets:
 *
 *   - **Opted out.** A `marketing_opt_outs` row outranks everything. Checked
 *     in the same statement that builds the list, so there is no path to a
 *     recipient set that skipped it.
 *   - **Deleted shop.** A seller who deleted their shop is not a seller
 *     halfway through onboarding, and "finish setting up your store" is the
 *     worst possible thing to send them.
 *   - **Paced.** Nobody hears from us twice inside `PACING_HOURS`.
 *   - **Windowed.** See above.
 *
 * Ordered oldest-signup-first so that a platform-wide backlog drains in the
 * order it built up, rather than starving the people who have been waiting
 * longest — the same fairness the broadcast queue takes.
 */
export async function lifecycleCandidates(opts: {
  now: Date;
  /** Hours of quiet each seller is owed between two lifecycle emails. */
  pacingHours: number;
  limit: number;
}): Promise<LifecycleState[]> {
  const db = getDb();

  const windowStart = new Date(
    opts.now.getTime() - CANDIDATE_WINDOW_DAYS * 24 * 3_600_000,
  );
  const quietSince = new Date(opts.now.getTime() - opts.pacingHours * 3_600_000);
  const revivalSince = new Date(
    opts.now.getTime() - REVIVAL_WINDOW_DAYS * 24 * 3_600_000,
  );

  const rows = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      signedUpAt: user.createdAt,

      shopId: shops.id,
      handle: shops.handle,
      shopName: shops.name,
      shopCreatedAt: shops.createdAt,
      plan: shops.plan,
      subscriptionStatus: shops.subscriptionStatus,
      compPlan: shops.compPlan,
      avatarUrl: shops.avatarUrl,
      logoUrl: shops.logoUrl,
      socials: shops.socials,
      stripeChargesEnabled: shops.stripeChargesEnabled,

      /*
       * Counted rather than joined. A join on four one-to-many tables at once
       * multiplies the rows out and then needs distinct aggregates to undo
       * it; scalar subqueries each read one shop's slice of one index.
       */
      productCount: sql<number>`(
        select count(*)::int from ${products}
        where ${products.shopId} = ${shops.id}
      )`,
      firstProductAt: sql<Date | null>`(
        select min(${products.createdAt}) from ${products}
        where ${products.shopId} = ${shops.id}
      )`,
      railCount: sql<number>`(
        select count(*)::int from ${paymentMethods}
        where ${paymentMethods.shopId} = ${shops.id}
          and ${paymentMethods.isEnabled}
      )`,
      /*
       * Cancelled and refunded orders are excluded from both the count and
       * the anchor. "You made your first sale" is not a thing to say about an
       * order the seller cancelled, and an anchor taken from one would time
       * every later email off a sale that never happened.
       */
      orderCount: sql<number>`(
        select count(*)::int from ${orders}
        where ${orders.shopId} = ${shops.id}
          and ${orders.status} not in ('cancelled', 'refunded')
      )`,
      firstOrderAt: sql<Date | null>`(
        select min(${orders.createdAt}) from ${orders}
        where ${orders.shopId} = ${shops.id}
          and ${orders.status} not in ('cancelled', 'refunded')
      )`,

      sentSteps: sql<string[]>`coalesce((
        select array_agg(${lifecycleEmails.step}) from ${lifecycleEmails}
        where ${lifecycleEmails.userId} = ${user.id}
      ), '{}')`,
      lastLifecycleAt: sql<Date | null>`(
        select max(${lifecycleEmails.createdAt}) from ${lifecycleEmails}
        where ${lifecycleEmails.userId} = ${user.id}
      )`,
    })
    .from(user)
    /*
     * A left join, and that is the feature. The row with no shop beside it is
     * the seller who signed up and stopped — the single most valuable person
     * in this pipeline and the one an inner join would silently drop.
     *
     * `deletedAt is null` sits in the join condition and not the WHERE for
     * the same reason: in the WHERE it would turn the left join back into an
     * inner one and lose every shopless seller with it.
     */
    .leftJoin(shops, and(eq(shops.userId, user.id), isNull(shops.deletedAt)))
    .where(
      and(
        gt(user.createdAt, windowStart),
        sql`not exists (
          select 1 from ${marketingOptOuts}
          where ${marketingOptOuts.email} = lower(${user.email})
        )`,
        sql`not exists (
          select 1 from ${lifecycleEmails}
          where ${lifecycleEmails.userId} = ${user.id}
            and ${lifecycleEmails.createdAt} > ${quietSince}
        )`,
        /*
         * A seller with no shop must have confirmed their address first.
         *
         * The line is drawn here rather than per-step because it is a fact
         * about the audience, not about any one email. Completing a sign-up
         * form is not evidence that the person at the keyboard owns the
         * address they typed — a mistyped address, or a deliberate one, would
         * otherwise receive three marketing emails from our verified sending
         * domain, and that is a spam complaint against the domain carrying
         * every seller's order confirmations.
         *
         * A shop lifts the requirement, and it is the right thing to lift it
         * on: building one means coming back and doing real work in the
         * product, which is evidence of a genuine account in a way that a
         * submitted form is not. It also keeps the requirement off the people
         * furthest down the funnel, where the mail is most useful and an
         * unclicked confirmation is least likely to mean anything sinister.
         */
        sql`(${shops.id} is not null or ${user.emailVerified})`,
        /*
         * Accounts the pipeline has already run out of things to say to.
         *
         * Without this the oldest dead signups sit at the front of every
         * tick's page forever — the pass reads them, finds nothing due, and
         * reads them again an hour later, while the people who signed up this
         * morning never fit inside the limit. The tombstone (`RETIRED_STEP`,
         * written by the send pass) takes them out.
         *
         * The exit is not permanent, and the second half of this clause is
         * why. A retired account that builds a shop comes straight back —
         * that is both the event most worth re-engaging on and the only one
         * that puts a rung genuinely within reach again, since every rung
         * past `shop_live` is anchored on something the shop does.
         */
        sql`(
          not exists (
            select 1 from ${lifecycleEmails}
            where ${lifecycleEmails.userId} = ${user.id}
              and ${lifecycleEmails.step} = ${RETIRED_STEP}
          )
          or ${shops.createdAt} > ${revivalSince}
        )`,
      ),
    )
    .orderBy(user.createdAt)
    .limit(opts.limit);

  return rows.map((row) => ({
    userId: row.userId,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerified,
    signedUpAt: row.signedUpAt,
    shop:
      row.shopId && row.handle && row.shopName && row.shopCreatedAt
        ? {
            id: row.shopId,
            handle: row.handle,
            name: row.shopName,
            createdAt: row.shopCreatedAt,
            plan: row.plan ?? "free",
            subscriptionStatus: row.subscriptionStatus,
            compPlan: row.compPlan,
            avatarUrl: row.avatarUrl,
            logoUrl: row.logoUrl,
            socials: row.socials ?? [],
            stripeChargesEnabled: row.stripeChargesEnabled ?? false,
          }
        : null,
    productCount: Number(row.productCount ?? 0),
    firstProductAt: asDate(row.firstProductAt),
    railCount: Number(row.railCount ?? 0),
    orderCount: Number(row.orderCount ?? 0),
    firstOrderAt: asDate(row.firstOrderAt),
    sent: new Set(row.sentSteps ?? []),
    lastLifecycleAt: asDate(row.lastLifecycleAt),
  }));
}

/**
 * Timestamps out of a raw subquery arrive as whatever the driver made of
 * them, which for `min(timestamp)` selected through `sql<Date>` is a string.
 * Normalised once here rather than defended against in every step predicate,
 * where a string that compares fine against another string would silently
 * make an anchor unreachable.
 */
function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * How many lifecycle emails the platform has sent in the last day.
 *
 * The ceiling this feeds is the shared-resource one, not a product decision:
 * every seller's order confirmations leave through the same sending domain,
 * so an unbounded marketing run does not damage marketing, it damages
 * receipts. Counted from `sentAt` rather than `createdAt` because a claim
 * that never left the building did not consume any provider budget.
 */
export async function sentTodayPlatform(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [row] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(lifecycleEmails)
    .where(
      and(
        sql`${lifecycleEmails.sentAt} is not null`,
        sql`${lifecycleEmails.sentAt} >= ${since}`,
      ),
    );
  return Number(row?.n ?? 0);
}
