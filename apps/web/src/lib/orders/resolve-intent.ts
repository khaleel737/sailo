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
import { releasesBeforePayment } from "@/lib/variants";
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
    currency: shop.currency,
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

  /*
   * The four independent lookups, at the same time.
   *
   * None of them needs another's answer: the rail, the delivery rate, the
   * coupon and the affiliate all depend only on the shop and the lines, which
   * are already in hand. Run one after another they were four sequential
   * requests on a driver where each one crosses the network on its own —
   * measured from across an ocean, six sequential statements cost 704ms and
   * the same six concurrently cost 127ms.
   *
   * The *validation* stays sequential below, in the order a buyer should meet
   * it: no rail is a different message from no delivery option, and answering
   * with whichever query happened to fail first would make the error depend on
   * network timing.
   */
  const subtotalCents = cartSubtotal(lines);
  // Decides the delivery rate below: only a physical good is shipped.
  const delivered = cartNeedsDelivery(lines);
  // Decides whether a pay-in-person rail may be used. It may, unless something
  // in the basket hands itself over before payment — an instant download.
  const canPayInPerson = !lines.some((line) =>
    releasesBeforePayment(line.product.kind, line.product.releaseOnPayment),
  );
  const affiliatesLive = shop.affiliatesEnabled && can(shop, "affiliates");
  const wantsAffiliate = affiliatesLive && Boolean(input.affiliateCode?.trim());

  const [method, delivery, discount, affiliateRow] = await Promise.all([
    db.query.paymentMethods.findFirst({
      where: and(
        eq(paymentMethods.shopId, shop.id),
        eq(paymentMethods.type, input.paymentMethod),
        eq(paymentMethods.isEnabled, true),
      ),
    }),
    // One fee for the order, and only when something in it has to travel: a
    // basket of downloads and appointments is never shipped.
    resolveDelivery(shop.id, delivered, input.deliveryMethodId),
    resolveCoupon({ shopId: shop.id, code: input.couponCode, subtotalCents, now }),
    wantsAffiliate
      ? db.query.affiliates.findFirst({
          where: and(
            eq(affiliates.shopId, shop.id),
            eq(affiliates.code, normalizeCode(input.affiliateCode ?? "")),
            eq(affiliates.status, "active"),
          ),
        })
      : Promise.resolve(undefined),
  ]);

  if (!method || !isRailUsable(method.type, method.config, shop)) {
    return { ok: false, error: "That option isn't available right now." };
  }
  // Gated rails are refused server-side too: a downgraded shop must not keep
  // taking card orders because a stale page still shows the button.
  if (method.type === "card" && !can(shop, "cardRails")) {
    return { ok: false, error: "That option isn't available right now." };
  }

  const def = PAYMENT_METHOD_DEFS[input.paymentMethod];

  /*
   * A pay-in-person rail needs a moment to collect the cash.
   *
   * The panel stops offering cash on delivery when the basket has nothing the
   * seller hands over in person — that is a decision made in a browser, and
   * this is the same one made where it counts. Physical goods, event tickets,
   * booked services and files held until paid all keep it; an instant download
   * is the only thing that does not, because it unlocks on order, so "pay when
   * we meet" would leave the seller an unpaid order for a file already gone.
   */
  if (def.payInPerson && !canPayInPerson) {
    return { ok: false, error: "That option isn't available right now." };
  }

  if (delivery === "unavailable") {
    return { ok: false, error: "Pick how you'd like to receive it." };
  }

  if (!discount.ok) return { ok: false, error: discount.error };
  const coupon = discount.coupon;

  // Commission only accrues while the shop is actually entitled to it.
  const affiliate: Affiliate | null = affiliateRow ?? null;

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
