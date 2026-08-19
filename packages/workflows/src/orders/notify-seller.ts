import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orderItems, orders, user, type Shop } from "@sailo/db/schema";
import { rateLimit } from "@sailo/rate-limit";
import { wantsNotification } from "@sailo/notifications/prefs";
import { pushSellerOrder } from "@sailo/notifications/push";
import {
  sendSellerBookingRequested,
  sendSellerLowStock,
  sendSellerOrderNeedsAction,
  sendSellerOrderPlaced,
} from "@sailo/email/shop";
import { afterStockChanged } from "@sailo/commerce/catalog";

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
  /*
   * DECISION B — deliberately stays open.
   *
   * This ceiling spends the shared send quota, which is the category that
   * otherwise fails closed. It is the exception because the mail is 1:1 with
   * orders: it cannot run away without a separate bug, and five hundred a day is
   * a backstop against that bug rather than against a caller. Closing it would
   * mean a cache outage silences every seller's order alerts — they find out
   * they had sales when they next open the admin — which is a worse day than the
   * quota risk it removes.
   */
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

/**
 * Where seller alerts go: `notificationEmail`, then `contactEmail`, then the
 * account's own address.
 *
 * Three steps rather than two since the settings screen grew a dedicated
 * notification address. The two are genuinely different questions — one is
 * where buyers write, the other is where alerts land — and a seller who routes
 * alerts to `ops@` while customers still write to `hello@` has said which is
 * which. Null here still means "fall back", never "send nothing"; turning an
 * alert off is what `notificationPrefs` is for, and reading an empty column as
 * silence would have muted every shop on the day it shipped.
 */
async function sellerAddress(shop: Shop): Promise<string | null> {
  if (shop.notificationEmail) return shop.notificationEmail;
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

/* -------------------------------------------------------------------------- */
/*  Running out                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Tells a seller their stock has fallen to the line they drew — spec 51.
 *
 * Called from every path that moves units: an order reserving them, a seller
 * editing the count, a refund putting them back. That breadth is exactly why
 * the *claim* lives in the database rather than here — a busy afternoon calls
 * this a dozen times and one email comes out of it.
 *
 * `afterStockChanged` does both halves in one call: it re-arms the alert when
 * stock has climbed back above the threshold, and claims the crossing when it
 * has fallen to it. Splitting them across call sites is how a codebase ends up
 * alerting once and then never again, because the reset was added to three of
 * the four places units move.
 *
 * Swallows everything, like every other function in this file. By the time it
 * runs the units have already moved and the order already exists; a mail
 * provider having a bad afternoon must never fail the thing it reports on.
 */
export async function notifySellerOfLowStock(opts: {
  shop: Shop;
  productId: string;
}): Promise<void> {
  try {
    const { shop, productId } = opts;

    const alert = await afterStockChanged(productId);
    if (!alert) return;

    /*
     * The preference is read *after* the claim, and that is deliberate.
     *
     * The claim is what records that this crossing has been dealt with. A
     * seller who has the alert switched off still crosses the threshold, and
     * spending the claim means the day they switch it back on they hear about
     * the *next* crossing rather than being immediately mailed about a
     * shortage they have been living with for a fortnight.
     */
    if (!wantsNotification(shop.notificationPrefs, "lowStock")) return;
    if (!(await underDailyCeiling(shop.id))) return;

    const to = await sellerAddress(shop);
    if (!to) return;

    const result = await sendSellerLowStock({
      shop,
      to,
      productTitle: alert.title,
      productId: alert.productId,
      threshold: alert.threshold,
      remaining: alert.remaining,
      variants: alert.variants,
    });
    if (!result.sent) {
      console.warn(`[sailo] low-stock email not sent: ${result.reason}`);
    }
  } catch (error) {
    console.error("[sailo] low-stock notification failed", error);
  }
}
