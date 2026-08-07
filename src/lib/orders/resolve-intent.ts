import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { affiliates, paymentMethods, type Affiliate, type Shop } from "@/db/schema";
import { present } from "@/lib/invariant";
import { can } from "@/lib/plans";
import { normalizeCode } from "@/lib/pricing";
import {
  isPaymentMethodType,
  isRailUsable,
  PAYMENT_METHOD_DEFS,
  type PaymentMethodDef,
  type PaymentMethodType,
} from "@/lib/payments";
import { cartNeedsDelivery, cartSubtotal, quote, type Quote } from "@/lib/quote";
import { readBuyer } from "@/lib/orders/buyer";
import { commissionBpFor } from "@/lib/orders/commission";
import { resolveCoupon } from "@/lib/orders/resolve-coupon";
import { resolveDelivery } from "@/lib/orders/delivery";
import { resolveLines } from "@/lib/orders/resolve-lines";
import type { BuyerDetails } from "@/lib/orders/buyer";
import type { OrderIntentInput, ResolvedLine } from "@/lib/orders/types";
import type { Coupon, DeliveryMethod, PaymentMethod } from "@/db/schema";

/**
 * Everything an order is, worked out before anything is written down.
 *
 * `createOrderIntent` had grown to nearly six hundred lines and, more to the
 * point, it grew by sixty-six *while being fixed* — which is what tangled
 * responsibilities look like from the outside. This is the first half of it,
 * and the seam is not a line count: it is that nothing here touches a row.
 *
 * Which products, at which prices, on which rail, with which delivery, coupon
 * and affiliate, adding up to which total, for which buyer — every one of
 * those can fail, and failing costs nothing because no stock has been taken,
 * no coupon spent, no appointment claimed and no order written. Past the end
 * of this function every failure needs an undo, and the undos are what the
 * hardest bugs in this file have all been about.
 *
 * Re-derived from the database rather than taken from the request. The client
 * sends product ids, a rail name and a coupon code; it does not send prices,
 * and nothing it does send about money survives this function.
 */

export type ResolvedIntent = {
  lines: ResolvedLine[];
  /** The first line, which the order header's columns are derived from. */
  head: ResolvedLine;
  /*
   * The row, not a narrowed shape. `isPaymentMethodType` narrows the *input*
   * — which is what decides whether this rail may be used at all — while the
   * stored row's `type` is a plain column, and pretending otherwise would be
   * asserting something the database does not guarantee.
   */
  method: PaymentMethod;
  /** The narrowed rail, for the callers that switch on it. */
  railType: PaymentMethodType;
  def: PaymentMethodDef;
  /*
   * `undefined`, not `null`, and the difference is load-bearing:
   * `resolveDelivery` answers `"unavailable"` when a basket needs delivering
   * and the chosen method does not exist, which is rejected above — so absent
   * here means "nothing in this basket travels", not "we could not price it".
   */
  delivery: DeliveryMethod | undefined;
  coupon: Coupon | null;
  affiliate: Affiliate | null;
  commissionBp: number | null;
  priced: Quote;
  buyer: BuyerDetails;
};

export type ResolveIntentResult =
  | { ok: true; intent: ResolvedIntent }
  | { ok: false; error: string };

export async function resolveOrderIntent(
  shop: Shop,
  input: OrderIntentInput,
  now: Date,
): Promise<ResolveIntentResult> {
  const db = getDb();

  /* ---- Lines ----------------------------------------------------------- */

  const resolved = await resolveLines(shop.id, input.items, {
    strict: true,
    now,
    // Committing, so booked slots are verified against what is still free.
    shop,
  });
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { lines } = resolved;
  // The first line stands in for the order wherever one product is expected.
  // Every path above rejects an empty basket, but the header columns are
  // derived from this line and a silent undefined would write a broken order.
  const head = present(lines[0], "at least one order line");

  if (!isPaymentMethodType(input.paymentMethod)) {
    return { ok: false, error: "Pick how you'd like to order." };
  }

  const method = await db.query.paymentMethods.findFirst({
    where: and(
      eq(paymentMethods.shopId, shop.id),
      eq(paymentMethods.type, input.paymentMethod),
      eq(paymentMethods.isEnabled, true),
    ),
  });
  if (!method || !isRailUsable(method.type, method.config, shop)) {
    return { ok: false, error: "That option isn't available right now." };
  }
  // Gated rails are refused server-side too: a downgraded shop must not keep
  // taking card orders because a stale page still shows the button.
  if (method.type === "card" && !can(shop, "cardRails")) {
    return { ok: false, error: "That option isn't available right now." };
  }

  const def = PAYMENT_METHOD_DEFS[input.paymentMethod];

  /* ---- Delivery ------------------------------------------------------- */

  // One fee for the order, and only when something in it has to travel: a
  // basket of downloads and appointments is never shipped.
  const delivery = await resolveDelivery(
    shop.id,
    cartNeedsDelivery(lines),
    input.deliveryMethodId,
  );
  if (delivery === "unavailable") {
    return { ok: false, error: "Pick how you'd like to receive it." };
  }

  /* ---- Coupon --------------------------------------------------------- */

  const subtotalCents = cartSubtotal(lines);
  const discount = await resolveCoupon({
    shopId: shop.id,
    code: input.couponCode,
    subtotalCents,
    now,
  });
  if (!discount.ok) return { ok: false, error: discount.error };
  const coupon = discount.coupon;

  /* ---- Affiliate ------------------------------------------------------ */

  // Commission only accrues while the shop is actually entitled to it.
  const affiliatesLive = shop.affiliatesEnabled && can(shop, "affiliates");

  let affiliate: Affiliate | null = null;
  if (affiliatesLive && input.affiliateCode?.trim()) {
    const found = await db.query.affiliates.findFirst({
      where: and(
        eq(affiliates.shopId, shop.id),
        eq(affiliates.code, normalizeCode(input.affiliateCode)),
        eq(affiliates.status, "active"),
      ),
    });
    affiliate = found ?? null;
  }

  const commissionBp = commissionBpFor(affiliate, shop);

  const priced: Quote = quote({
    lines,
    coupon,
    deliveryMethod: delivery,
    commissionBp,
    tax: shop,
    collectAddress: shop.collectAddress,
    deliveryType: delivery?.type ?? null,
    now,
  });
  const wantsAddress = priced.needsAddress;

  const read = readBuyer(input, { def, wantsAddress });
  if (!read.ok) return { ok: false, error: read.error };

  return {
    ok: true,
    intent: {
      lines,
      head,
      method,
      railType: input.paymentMethod,
      def,
      delivery,
      coupon,
      affiliate,
      commissionBp,
      priced,
      buyer: read.buyer,
    },
  };
}
