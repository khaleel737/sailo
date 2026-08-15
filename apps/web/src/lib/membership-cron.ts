import "server-only";
import { and, asc, eq, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, orders, products, shops, subscriptions, type Subscription } from "@sailo/db/schema";
import { MANUAL_LAPSE_DAYS, RENEWAL_LEAD_DAYS } from "@sailo/core/memberships";
import { sendMembershipRenewalDue } from "@/lib/email/messages";
import { notifySellerOfOrder } from "@/lib/orders/notify-seller";
import { publishShopEvent } from "@sailo/events";
import { type RenewalTick } from "@sailo/commerce/membership-renewals";
import { downloadUrl } from "@sailo/commerce/downloads";

/**
 * The manual renewal cron.
 *
 * Split from `@sailo/commerce/membership-renewals` when the phone needed the
 * other half of that file — `extendForPaidOrder`, which is what "the seller
 * confirmed the money arrived" actually does. That half is now shared; this
 * one stayed.
 *
 * It stayed because it is the only part that reaches things only a website
 * has: `notifySellerOfOrder` fans out into push tokens and seller email
 * preferences, and `sendMembershipRenewalDue` is a message the *platform*
 * sends on a schedule rather than one a seller triggers. Neither is a thing a
 * phone does, and moving them would have meant moving a third of apps/web
 * behind them.
 */

/**
 * One pass of the manual renewal cycle.
 *
 * Two jobs, in this order: raise the next period's order for memberships
 * coming up for renewal, and close the ones nobody has paid for in a long
 * time. Both are fleet-wide — this is a cron, not a per-shop action — and both
 * are claimed rather than checked, so two overlapping ticks do the work once
 * between them.
 */
export async function runManualRenewals(now = new Date()): Promise<RenewalTick> {
  const db = getDb();

  /*
   * Due, or nearly. `RENEWAL_LEAD_DAYS` ahead of the period end, because a
   * bank transfer takes days to arrive and the seller then has to see it: a
   * request sent on the morning access expires is a request that arrives too
   * late to be acted on.
   *
   * `cancelAtPeriodEnd` is excluded — a member who has said they are leaving
   * must not be sent an invitation to pay for another month.
   */
  const horizon = new Date(now.getTime() + RENEWAL_LEAD_DAYS * 86_400_000);

  const due = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.billingMode, "manual"),
      or(eq(subscriptions.status, "active"), eq(subscriptions.status, "past_due")),
      eq(subscriptions.cancelAtPeriodEnd, false),
      lte(subscriptions.currentPeriodEnd, horizon),
      /*
       * Not already asked. Compared against the period end rather than a
       * boolean, so the marker from *last* period does not suppress this
       * one — which is how a renewal system silently stops renewing.
       */
      or(
        isNull(subscriptions.renewalOrderedFor),
        ne(subscriptions.renewalOrderedFor, subscriptions.currentPeriodEnd),
      ),
    ),
    limit: 200,
  });

  let raised = 0;
  for (const row of due) {
    if (await raiseRenewalOrder(row)) raised += 1;
  }

  /*
   * And the ones nobody is paying. Access stopped when the period ended —
   * `membershipAccess` saw to that without any help — so this is only about
   * telling the truth in the seller's list and not asking for ever.
   */
  const lapseBefore = new Date(now.getTime() - MANUAL_LAPSE_DAYS * 86_400_000);
  const lapsed = await db
    .update(subscriptions)
    .set({ status: "canceled", canceledAt: now, updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.billingMode, "manual"),
        or(eq(subscriptions.status, "active"), eq(subscriptions.status, "past_due")),
        lte(subscriptions.currentPeriodEnd, lapseBefore),
      ),
    )
    .returning({ id: subscriptions.id });

  return { raised, lapsed: lapsed.length };
}

/**
 * The next period's order, raised once.
 *
 * The claim is the conditional UPDATE on `renewalOrderedFor`: only the caller
 * that moves it to this period's end goes on to write an order, so two ticks
 * running at once — or a tick that ran twice — ask the member for one month,
 * not two. Everything after the claim is safe to repeat.
 */
async function raiseRenewalOrder(row: Subscription): Promise<boolean> {
  const db = getDb();

  const [claimed] = await db
    .update(subscriptions)
    .set({
      renewalOrderedFor: row.currentPeriodEnd,
      // Asked and not yet paid. Access is untouched — they are still inside
      // the period they paid for, and `membershipAccess` closes it on time.
      status: "past_due",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(subscriptions.id, row.id),
        or(
          isNull(subscriptions.renewalOrderedFor),
          ne(subscriptions.renewalOrderedFor, subscriptions.currentPeriodEnd),
        ),
      ),
    )
    .returning();
  if (!claimed) return false;

  const [shop, client, product] = await Promise.all([
    db.query.shops.findFirst({ where: eq(shops.id, row.shopId) }),
    row.clientId
      ? db.query.clients.findFirst({ where: eq(clients.id, row.clientId) })
      : Promise.resolve(undefined),
    row.productId
      ? db.query.products.findFirst({ where: eq(products.id, row.productId) })
      : Promise.resolve(undefined),
  ]);
  if (!shop) return false;

  /*
   * An ordinary unpaid order, exactly like one the buyer placed themselves.
   *
   * That is what makes the rest of the product work without knowing about
   * memberships: it appears in the seller's order list, it can be marked paid
   * from the same dropdown, it carries the same payment instructions, and it
   * counts in Income when it settles. The only thing marking it out is
   * `subscriptionId`.
   *
   * Priced from the subscription, not the product: the member is on the price
   * they signed up at, and a seller raising their rates does not get to
   * silently re-price somebody mid-arrangement.
   */
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      productId: row.productId,
      clientId: row.clientId,
      subscriptionId: row.id,

      productTitle: product?.title ?? "Membership",
      productKind: "membership",
      unitPriceCents: row.priceCents,
      quantity: 1,
      itemCount: 1,
      currency: row.currency,
      subtotalCents: row.priceCents,
      totalCents: row.priceCents,

      customerName: client?.name ?? "Member",
      customerEmail: client?.email ?? null,
      customerPhone: client?.phone ?? null,

      paymentMethod: row.paymentMethod ?? "bank_transfer",
      paymentStatus: "unpaid",
      status: "new",
    })
    .returning();
  if (!order) return false;

  /*
   * And the member is told, because on this rail nothing else will tell them.
   *
   * The link is their own membership page — the signup order's token, which is
   * the one durable address they have — where the shop's payment instructions
   * live. Best-effort: a mail outage must not stop the renewal being raised,
   * because the order is what the seller collects against either way.
   */
  const to = client?.email ?? null;
  if (to) {
    const signup = await db.query.orders.findFirst({
      where: and(
        eq(orders.subscriptionId, row.id),
        isNotNull(orders.downloadToken),
      ),
      orderBy: [asc(orders.createdAt)],
    });

    await sendMembershipRenewalDue({
      shop,
      to,
      name: client?.name ?? null,
      productTitle: product?.title ?? "your membership",
      priceCents: row.priceCents,
      currency: row.currency,
      until: row.currentPeriodEnd,
      manageUrl: signup?.downloadToken ? downloadUrl(signup.downloadToken) : null,
    });
  }

  /*
   * The seller's copy, through the same path every other order uses — so it
   * respects their notification preferences rather than inventing a second
   * channel that ignores them.
   */
  await notifySellerOfOrder({ shop, orderId: order.id });

  await publishShopEvent(shop.id, "order");
  return true;
}
