import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, subscriptions, type Order, type Subscription } from "@/db/schema";
import { membershipAccess, type MembershipAccess } from "@/lib/memberships";

/**
 * Whether a member may still get in, asked at the moment they ask.
 *
 * Not at the moment the link was minted, and that distinction is the whole
 * feature. A membership's download token is handed out once and lives in an
 * inbox forever; if entitlement were decided when the token was created, a
 * member who cancelled in March would still be downloading the April files in
 * September. So the token proves *who* is asking and this decides *whether*,
 * on every single request.
 *
 * The grace is deliberate and it is the seller's obligation, not a kindness:
 * somebody who paid for March keeps March even if they cancel on the 2nd.
 * `membershipAccess` holds that line against `currentPeriodEnd`; nothing here
 * shortens it.
 */

export type OrderAccess = {
  /** True when the order is a membership at all. Everything else is unaffected. */
  isMembership: boolean;
  subscription: Subscription | null;
  access: MembershipAccess;
  /**
   * A manual renewal has been raised and is waiting to be paid.
   *
   * Not the same as `past_due` on a card, which means a charge was attempted
   * and failed. Here nothing has been attempted — the member has been asked
   * and has not paid yet, which is an ordinary state on a bank transfer and
   * deserves ordinary words.
   */
  awaitingPayment: boolean;
};

/**
 * The subscription behind an order, whichever kind of order it is.
 *
 * Two ways in, because a member's files hang off the *signup* order while
 * every renewal writes its own: `subscriptionId` names it directly when the
 * order is one of the subscription's payments, and the fallback covers a
 * signup order whose webhook has not linked it yet — a window of seconds
 * during which the buyer is on the success page looking at their new
 * membership.
 */
export async function subscriptionForOrder(
  order: Pick<Order, "id" | "shopId" | "clientId" | "productId" | "subscriptionId">,
): Promise<Subscription | null> {
  const db = getDb();

  if (order.subscriptionId) {
    const byId = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.id, order.subscriptionId),
        // Shop-scoped even though the id came from our own row: a mismatch
        // here would be a bug, and one that hands out somebody else's access.
        eq(subscriptions.shopId, order.shopId),
      ),
    });
    if (byId) return byId;
  }

  if (!order.clientId || !order.productId) return null;

  /*
   * The newest, not the first. A member who cancelled and came back has two
   * rows for the same product, and the old cancelled one would refuse
   * somebody who is currently paying.
   */
  return (
    (await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.shopId, order.shopId),
        eq(subscriptions.clientId, order.clientId),
        eq(subscriptions.productId, order.productId),
      ),
      orderBy: [desc(subscriptions.createdAt)],
    })) ?? null
  );
}

/**
 * Whether this order's files are open right now.
 *
 * Answers `isMembership: false` for everything else, which is what lets the
 * callers apply it unconditionally: an ordinary digital order is decided by
 * `downloadState` alone, and adding a membership check that always passes is
 * cheaper to read than a branch at every call site.
 */
export async function accessForOrder(
  order: Pick<
    Order,
    "id" | "shopId" | "clientId" | "productId" | "subscriptionId" | "productKind"
  >,
  now = new Date(),
): Promise<OrderAccess> {
  const isMembershipOrder =
    order.productKind === "membership" || Boolean(order.subscriptionId);

  if (!isMembershipOrder) {
    return {
      isMembership: false,
      subscription: null,
      access: { open: true, endingSoon: false, until: null },
      awaitingPayment: false,
    };
  }

  const subscription = await subscriptionForOrder(order);

  /*
   * Whether there is an unpaid renewal sitting against this membership. Only
   * ever true on a manual one — a card renewal is charged rather than asked
   * for, so it is never waiting on the member to do anything.
   */
  const awaitingPayment =
    subscription?.billingMode === "manual" &&
    Boolean(
      await getDb().query.orders.findFirst({
        where: and(
          eq(orders.subscriptionId, subscription.id),
          eq(orders.paymentStatus, "unpaid"),
        ),
        columns: { id: true },
      }),
    );

  return {
    isMembership: true,
    subscription,
    access: membershipAccess(subscription, now),
    awaitingPayment,
  };
}

/**
 * The same question asked from the streaming route, where only the token is in
 * hand and a boolean is all that is wanted.
 *
 * Separate from `accessForOrder` rather than wrapping it, because this one has
 * to be cheap: it runs on every byte-serving request, before anything is
 * fetched, and it must not become the reason a download is slow.
 */
export async function membershipOpenForOrder(
  order: Pick<
    Order,
    "id" | "shopId" | "clientId" | "productId" | "subscriptionId" | "productKind"
  >,
  now = new Date(),
): Promise<boolean> {
  const { isMembership, access } = await accessForOrder(order, now);
  return !isMembership || access.open;
}

/**
 * Every membership a shop is currently owed money for, newest first.
 *
 * The members list. `statuses` narrows it — the default is everything, because
 * a seller looking at their members wants the cancelled ones visible too:
 * "who left last month" is the question that makes them do something about it.
 */
export async function shopSubscriptions(
  shopId: string,
  opts: { statuses?: string[]; limit?: number } = {},
) {
  return getDb()
    .query.subscriptions.findMany({
      where: and(
        eq(subscriptions.shopId, shopId),
        ...(opts.statuses?.length
          ? [inArray(subscriptions.status, opts.statuses)]
          : []),
      ),
      orderBy: [desc(subscriptions.createdAt)],
      limit: opts.limit ?? 200,
    });
}
