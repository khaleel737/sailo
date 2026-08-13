import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orderItems, orders, user, type Shop } from "@sailo/db/schema";
import { rateLimit } from "@sailo/rate-limit";
import { wantsNotification } from "@/lib/notification-prefs";
import { pushSellerOrder } from "@/lib/orders/push";
import {
  sendSellerBookingRequested,
  sendSellerOrderNeedsAction,
  sendSellerOrderPlaced,
} from "@/lib/email/seller-messages";

/**
 * Telling the seller something happened in their shop.
 *
 * Same contract as `confirmBuyerByEmail`, and for the same reason: by the time
 * this runs the order exists and the money is wherever it is, so a mail
 * provider having a bad afternoon must never fail the thing it reports on.
 * Every failure is logged and swallowed; nothing here is awaited into a
 * position where a caller could care.
 *
 * What decides whether anything goes out at all lives here, not in the
 * builders: the shop's prefs (`notificationPrefs`, absence means on) and a
 * per-shop daily ceiling so a bug or an order bomb cannot burn the Resend
 * quota.
 *
 * There are two channels and one decision. An order also pushes to the
 * seller's phone (`./push.ts`), and it does so from inside this function on
 * purpose — behind the same preference and the same ceiling. A second entry
 * point for "tell the seller" is how a shop ends up muted in one place and
 * shouting in another, and the test beside this file pins the send sites for
 * exactly that reason.
 */

/**
 * Generous against any real shop — order mail is 1:1 with orders — and tight
 * against a runaway loop. Counted per shop per day in Redis; fails open like
 * every limit here, because losing a day's ceiling is cheaper than losing a
 * day's notifications.
 */
const DAILY_CEILING = 500;

/**
 * Shops whose ceiling this instance has already reported, so a burst logs one
 * line instead of five hundred. Per-instance and reset on recycle, which is
 * the right cost for a log-noise guard.
 */
const ceilingLogged = new Set<string>();

async function underDailyCeiling(shopId: string): Promise<boolean> {
  const verdict = await rateLimit(`seller-mail:${shopId}`, DAILY_CEILING, 86_400);
  if (!verdict.allowed && !ceilingLogged.has(shopId)) {
    ceilingLogged.add(shopId);
    console.error(
      `[sailo] seller notification ceiling hit for shop ${shopId} — ` +
        `suppressing further seller mail today`,
    );
  }
  return verdict.allowed;
}

/** `shop.contactEmail` when the seller set one, else the account's own email. */
async function sellerAddress(shop: Shop): Promise<string | null> {
  if (shop.contactEmail) return shop.contactEmail;
  const owner = await getDb().query.user.findFirst({
    where: eq(user.id, shop.userId),
    columns: { email: true },
  });
  return owner?.email ?? null;
}

/**
 * The seller's copy of a settled order.
 *
 * Called from exactly two places — `createOrderIntent` for the rails that
 * settle at checkout, and the Connect webhook when a card payment lands — and
 * the same `settlesAtCheckout` discriminator the buyer's confirmation uses
 * guarantees only one of them fires per order. Webhook replays are already
 * fenced by the event-id claim in `stripe-webhooks/idempotency.ts`, so a
 * redelivery never reaches this function twice for one event.
 *
 * An order carrying a requested appointment gets the booking mail *instead* —
 * the seller's next move there is accept or decline, not fulfil, and two
 * emails about one order is how sellers learn to ignore both.
 */
export async function notifySellerOfOrder(opts: {
  shop: Shop;
  orderId: string;
}): Promise<void> {
  try {
    const { shop, orderId } = opts;
    const db = getDb();

    // Read back rather than reuse the caller's draft, like the buyer's
    // confirmation: the row is what the seller will find in their admin.
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    if (!order) return;

    const booking = Boolean(order.scheduledFor);
    const wanted = wantsNotification(
      shop.notificationPrefs,
      booking ? "bookingRequested" : "orderPlaced",
    );
    if (!wanted) return;
    if (!(await underDailyCeiling(shop.id))) return;

    /*
     * The phone, before the inbox and deliberately not after the `to` guard
     * below. A seller who never set a contact email and whose account address
     * has gone stale still has a handset in their pocket, and that is the one
     * notification they actually feel — gating it on an email address existing
     * would switch off the better channel whenever the worse one is missing.
     *
     * It rides the same preference and the same daily ceiling as the mail
     * rather than getting its own: the switch means "tell me when an order is
     * placed", not "email me", and a seller who turned it off has said no to
     * being told. Its own ceiling would also be its own way to notify a seller
     * five hundred times, which is the thing the ceiling exists to prevent.
     */
    await pushSellerOrder({ shop, order, booking });

    const to = await sellerAddress(shop);
    if (!to) return;

    const items = await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, orderId),
      orderBy: [asc(orderItems.position)],
    });

    const result = booking
      ? await sendSellerBookingRequested({ shop, order, items, to })
      : await sendSellerOrderPlaced({ shop, order, items, to });

    if (!result.sent) {
      console.warn(`[sailo] seller order email not sent: ${result.reason}`);
    }
  } catch (error) {
    console.error("[sailo] seller order notification failed", error);
  }
}

/**
 * A buyer reported a manual payment — a transfer reference, or uploaded
 * proof. The seller is the only person who can confirm the money arrived.
 */
export async function notifySellerOfPaymentReport(opts: {
  shop: Shop;
  orderId: string;
  supplied: "reference" | "proof";
}): Promise<void> {
  try {
    const { shop, orderId, supplied } = opts;

    if (!wantsNotification(shop.notificationPrefs, "orderNeedsAction")) return;
    if (!(await underDailyCeiling(shop.id))) return;

    const to = await sellerAddress(shop);
    if (!to) return;

    const order = await getDb().query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    if (!order) return;

    const result = await sendSellerOrderNeedsAction({ shop, order, to, supplied });
    if (!result.sent) {
      console.warn(`[sailo] seller payment email not sent: ${result.reason}`);
    }
  } catch (error) {
    console.error("[sailo] seller payment notification failed", error);
  }
}
