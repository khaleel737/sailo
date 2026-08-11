"use client";

import { useEffect } from "react";
import { clearPendingOrder, clearStoredCart, readPendingOrder } from "@/lib/cart";

/**
 * Empties the basket that became this order.
 *
 * A card checkout parks its order id and leaves the basket alone, because at
 * that moment nothing has been paid — see the note in `lib/cart.ts`. Stripe's
 * success URL lands here, so this is the first page that knows the money
 * moved, and it is where the basket stops being one.
 *
 * Matching on the parked id is the whole safety. A buy-now purchase parks
 * nothing, so paying for one product can never empty a basket it did not come
 * from; an invoice opened later from an email finds the marker already gone
 * and does nothing; and a manual-rail invoice never had a marker at all.
 */
export function SettleBasket({
  shopId,
  orderId,
}: {
  shopId: string;
  orderId: string;
}) {
  useEffect(() => {
    if (readPendingOrder(shopId) !== orderId) return;
    clearStoredCart(shopId);
    clearPendingOrder(shopId);
  }, [shopId, orderId]);

  return null;
}
