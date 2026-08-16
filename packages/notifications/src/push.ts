import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { pushTokens, type Order, type Shop } from "@sailo/db/schema";
import { orderSummaryTitle } from "@sailo/commerce/order-lines";
import { formatMoney } from "@sailo/core/currency";

/**
 * The seller's phone, told that something happened in their shop.
 *
 * This is the *transport* half of a seller notification and nothing else. It
 * does not decide whether to notify anyone — the prefs and the daily ceiling
 * live in `notify-seller.ts`, which is the one place that decision is made, and
 * this is called from inside it after that decision has already gone the right
 * way. Adding a second caller would be adding a second notification path, which
 * is exactly the thing `notify-seller.test.ts` exists to prevent.
 *
 * Same contract as the mail senders it sits beside: every failure is logged and
 * swallowed. By the time this runs the order exists and the money has moved, so
 * Expo having a bad afternoon must never turn into a failed checkout or a
 * non-2xx back to Stripe.
 */

const ENDPOINT = "https://exp.host/--/api/v2/push/send";

/**
 * Expo is a third party on the critical path of a webhook Stripe will retry.
 * A hung connection with no ceiling is how one slow dependency becomes a queue
 * of redelivered payments, so the request gets a hard stop.
 */
const TIMEOUT_MS = 5_000;

/**
 * Expo accepts 100 messages per request. No real seller has 100 devices — this
 * is a bound on a bug, not on a use case, and reading more would only mean
 * building a request Expo refuses whole.
 */
const MAX_DEVICES = 100;

/** What Expo returns per message, as much of it as we actually read. */
type PushReceipt = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * A device Expo says is gone: the app was uninstalled, or the token was
 * reissued. It will never be deliverable again, so the row is deleted rather
 * than retried — this is the only signal we get that a device stopped
 * existing, and ignoring it means pushing to the dead forever.
 */
const DEAD = "DeviceNotRegistered";

/**
 * Tell every device this seller has that an order arrived.
 *
 * `booking` picks the wording for the same reason the mail does: a requested
 * appointment needs accepting or declining, and calling that "new order" sends
 * the seller to the wrong screen.
 */
export async function pushSellerOrder(opts: {
  shop: Shop;
  order: Order;
  booking: boolean;
}): Promise<void> {
  const { shop, order, booking } = opts;

  const amount = formatMoney(order.totalCents, order.currency);
  await pushToUser(shop.userId, {
    title: booking ? "Booking request" : `New order · ${amount}`,
    body: booking
      ? `${order.customerName ?? "Someone"} asked to book ${orderSummaryTitle(order)}`
      : `${orderSummaryTitle(order)}${
          order.itemCount > 1 ? ` + ${order.itemCount - 1} more` : ""
        } — ${order.customerName ?? "someone"}`,
    /*
     * Enough for the app to open the right thing, and no more. A push payload
     * is stored by Apple and Google on the way through and is readable from a
     * locked screen, so it carries an id the app can look up rather than the
     * order itself.
     */
    data: { kind: booking ? "booking" : "order", orderId: order.id },
  });
}

type PushMessage = {
  title: string;
  body: string;
  data: Record<string, string>;
};

async function pushToUser(userId: string, message: PushMessage): Promise<void> {
  try {
    const db = getDb();
    const devices = await db.query.pushTokens.findMany({
      where: eq(pushTokens.userId, userId),
      columns: { token: true },
      limit: MAX_DEVICES,
    });
    if (devices.length === 0) return;

    const tokens = devices.map((d) => d.token);
    const receipts = await deliver(tokens, message);
    if (!receipts) return;

    /*
     * Expo answers positionally — receipt N is about token N — so a short or
     * misaligned array is read as "no verdict" rather than pruning by index and
     * deleting a live device on the strength of a guess.
     */
    if (receipts.length !== tokens.length) return;

    const dead = tokens.filter((_, i) => receipts[i]?.details?.error === DEAD);
    if (dead.length > 0) {
      await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
    }

    for (const [i, receipt] of receipts.entries()) {
      if (receipt?.status === "error" && receipt.details?.error !== DEAD) {
        console.warn(
          `[sailo] push rejected for device ${i + 1}/${tokens.length}: ` +
            `${receipt.details?.error ?? "unknown"} — ${receipt.message ?? ""}`,
        );
      }
    }
  } catch (error) {
    console.error("[sailo] seller push notification failed", error);
  }
}

/** One request to Expo, or null if it could not be made sense of. */
async function deliver(
  tokens: string[],
  message: PushMessage,
): Promise<PushReceipt[] | null> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  /*
   * Only needed once a project turns on Expo's push security, and absent
   * everywhere until someone does. Read rather than required so this ships
   * working and gains the header the day the variable is set.
   */
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(
      tokens.map((to) => ({
        to,
        title: message.title,
        body: message.body,
        data: message.data,
        sound: "default",
        // The seller is being told money arrived; it should not wait for the
        // next time the phone happens to wake up.
        priority: "high",
      })),
    ),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    console.warn(`[sailo] expo push HTTP ${response.status}`);
    return null;
  }

  const payload: unknown = await response.json();
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) ? (data as PushReceipt[]) : null;
}
