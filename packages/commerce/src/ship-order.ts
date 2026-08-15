import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, type Order, type Shop } from "@sailo/db/schema";

/**
 * Recording dispatch, from either surface.
 *
 * Smaller than `refundOrder` and for a good reason: nothing here can half-fail.
 * There is no processor to call, no balance to claim, and no ordering that
 * loses anything if it goes wrong — a tracking number written twice is a
 * tracking number.
 *
 * WHAT IT STILL OWNS
 *
 * The URL. A carrier's tracking link is pasted by hand and half of them arrive
 * without a scheme or with a stray space, so parsing *is* the validation — and
 * a link that fails to parse must be refused rather than stored, because the
 * only place it is ever used is a button in the buyer's email.
 *
 * `shippedAt` is set once and never moved. Re-saving this is how a seller
 * corrects a tracking number they mistyped, and rewriting the timestamp each
 * time would say the parcel left again today.
 */

export type ShipHooks = {
  defer?: (task: () => Promise<void>) => void;
  /** The buyer's tracking email. Absent on a surface that cannot send one. */
  notify?: (input: { shop: Shop; order: Order }) => Promise<{ sent: boolean; reason?: string }>;
};

export type ShipResult =
  | {
      ok: true;
      /**
       * Whether the buyer was actually told, and why not.
       *
       * Reported rather than swallowed: an order taken over the counter has no
       * email address, which is a fact about the order — but a *send* that
       * failed is a fact about the system, and a seller who believes their
       * buyer has tracking when they do not will not chase it.
       */
      notified: { sent: boolean; reason?: string } | null;
    }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "bad_tracking_url" };

export async function shipOrder(
  input: {
    shop: Shop;
    orderId: string;
    carrier?: string | null;
    trackingNumber?: string | null;
    /** Accepted with or without a scheme; parsed here, refused if unusable. */
    trackingUrl?: string | null;
  },
  hooks: ShipHooks = {},
): Promise<ShipResult> {
  const db = getDb();

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, input.orderId), eq(orders.shopId, input.shop.id)),
  });
  if (!order) return { ok: false, reason: "not_found" };

  const raw = input.trackingUrl?.trim().slice(0, 500) ?? "";
  let trackingUrl: string | null = null;
  if (raw) {
    /* Sellers paste `dhl.com/track?id=…` as often as they paste a full URL. */
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      trackingUrl = new URL(candidate).toString();
    } catch {
      return { ok: false, reason: "bad_tracking_url" };
    }
  }

  await db
    .update(orders)
    .set({
      trackingCarrier: input.carrier?.trim().slice(0, 80) || null,
      trackingNumber: input.trackingNumber?.trim().slice(0, 120) || null,
      trackingUrl,
      /* Set once. Re-saving corrects a typo; it does not re-dispatch. */
      shippedAt: order.shippedAt ?? new Date(),
      status: "shipped",
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, order.id), eq(orders.shopId, input.shop.id)));

  let notified: { sent: boolean; reason?: string } | null = null;

  if (hooks.notify) {
    const notify = hooks.notify;
    /* The row after the write — the email prints the tracking number that was
       just saved, not the one the caller was holding. */
    const updated = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    if (updated?.customerEmail) {
      if (hooks.defer) {
        hooks.defer(async () => {
          await notify({ shop: input.shop, order: updated });
        });
        /* Deferred, so whether it landed is not yet knowable. `null` says "not
           asked"; a caller that needs the answer does not pass `defer`. */
      } else {
        notified = await notify({ shop: input.shop, order: updated });
      }
    } else {
      notified = { sent: false, reason: "no customer email" };
    }
  }

  return { ok: true, notified };
}
