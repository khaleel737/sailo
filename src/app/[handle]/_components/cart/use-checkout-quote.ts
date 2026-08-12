"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { previewOrder } from "@/lib/actions/order-preview";
import type { OrderLineInput, OrderPreview, PreviewTax } from "@/lib/orders/types";
import type { Totals } from "@/lib/pricing";
import { couponFor, couponReducer, NO_COUPON } from "../../_lib/coupon-state";

/**
 * What the basket costs, according to the server.
 *
 * Every figure a buyer sees comes from `previewOrder` rather than from
 * arithmetic in the browser, so the quote cannot drift from what is actually
 * charged — the order is priced again on the server before any money moves,
 * and a total that disagreed with that would be a promise the checkout could
 * not keep.
 *
 * Extracted from `CheckoutPanel` because it is the part that is genuinely
 * stateful and genuinely testable, and it was buried among six `useState`
 * calls and a keyboard listener. What is left in the panel is layout.
 */

export const EMPTY_TOTALS: Totals = {
  subtotalCents: 0,
  discountCents: 0,
  deliveryFeeCents: 0,
  taxCents: 0,
  totalCents: 0,
  commissionCents: 0,
};

export function useCheckoutQuote(input: {
  shopId: string;
  items: OrderLineInput[];
  deliveryId: string | null;
  /**
   * Where the buyer says it's going. Sent so the total is priced against a
   * rate they can actually have — the panel has already stopped offering the
   * ones that don't reach, and this is the server agreeing.
   */
  country?: string;
  /**
   * What the caller already knows about whether this order travels, from the
   * kinds it holds. Used for the first paint only — the server's answer
   * replaces it the moment it lands, and it is the server's that the order is
   * priced and placed on. Without it the panel opens as though nothing ships
   * and then grows a delivery block, which is a worse first frame than the
   * one the page can work out for itself.
   */
  needsDeliveryHint?: boolean;
}) {
  const { shopId, items, deliveryId, country, needsDeliveryHint = false } = input;

  const [coupon, dispatchCoupon] = useReducer(couponReducer, NO_COUPON);
  const [preview, setPreview] = useState<OrderPreview | null>(null);

  // An array prop is a new object every render; the contents are what matter.
  const itemsKey = useMemo(() => JSON.stringify(items), [items]);

  useEffect(() => {
    // Nothing to price — the empty state is showing instead of the form, so a
    // stale preview can't be seen.
    if (items.length === 0) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await previewOrder({
          shopId,
          items,
          deliveryMethodId: deliveryId ?? undefined,
          couponCode: couponFor(coupon),
          country,
        });
        if (cancelled || "error" in res) return;
        setPreview(res);
        // A code that was fine a moment ago can stop qualifying when the
        // basket shrinks below its minimum, so it's dropped rather than
        // silently kept.
        if (coupon.applied && res.couponError) {
          dispatchCoupon({ type: "lapsed", message: res.couponError });
        }
      } catch {
        // The last good total stays on screen. It is only ever a quote —
        // the order is priced again on the server before anything is
        // charged — so a failed refresh costs a stale figure, not money.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, itemsKey, deliveryId, country, coupon.applied]);

  async function applyCoupon() {
    const code = coupon.input.trim();
    if (!code) return;
    dispatchCoupon({ type: "checking" });

    // The same four inputs as the effect above, country included: this reply
    // replaces the preview wholesale, so a narrower call here would price the
    // basket against a delivery rate the buyer can't have.
    const res = await previewOrder({
      shopId,
      items,
      deliveryMethodId: deliveryId ?? undefined,
      couponCode: code,
      country,
    });
    if ("error" in res) {
      dispatchCoupon({ type: "rejected", message: res.error });
      return;
    }
    if (res.couponError) {
      dispatchCoupon({ type: "rejected", message: res.couponError });
      return;
    }
    // The server's spelling wins, so the buyer sees the code as the shop
    // wrote it rather than as they typed it.
    dispatchCoupon({ type: "applied", code: res.couponApplied ?? code.toUpperCase() });
    setPreview(res);
  }

  return {
    preview,
    coupon,
    dispatchCoupon,
    applyCoupon,
    /*
     * The code to send with the order, which is not the same as what the
     * buyer typed: only an *applied* code counts. Exposed from here so the
     * quote and the order are guaranteed to be priced against the same one.
     */
    couponCode: couponFor(coupon),
    totals: preview?.totals ?? EMPTY_TOTALS,
    tax: (preview?.tax ?? null) as PreviewTax,
    /*
     * Both decided by the server, not inferred here: a basket of downloads is
     * not shipped, and a collection order has nowhere to deliver to. The hint
     * only stands in for the first, and only until the first quote answers.
     */
    needsDelivery: preview?.needsDelivery ?? needsDeliveryHint,
    needsAddress: preview?.needsAddress ?? false,
    /*
     * Whether an inbox is required rather than merely welcome. False until the
     * first quote, so the field starts optional and firms up — the opposite
     * order would mark a field required and then release it, which reads as
     * the form changing its mind.
     */
    needsEmail: preview?.needsEmail ?? false,
    // Optimistic until the first quote: show the pay-in-person rail, and let
    // the server withdraw it for the one basket that can't have it (an instant
    // download). Better first frame than hiding it and growing it back.
    canPayInPerson: preview?.canPayInPerson ?? true,
  };
}
