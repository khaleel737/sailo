import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { affiliates, paymentMethods, type Affiliate, type Shop } from "@sailo/db/schema";
import { present } from "@/lib/invariant";
import { countryName, normalizeCountry } from "@/lib/countries";
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
import { cartCanPayInPerson } from "@/lib/variants";
import { readBuyer } from "@/lib/orders/buyer";
import { commissionBpFor } from "@/lib/orders/commission";
import { resolveCoupon } from "@/lib/orders/resolve-coupon";
import { resolveDelivery } from "@/lib/orders/delivery";
import { resolveLines } from "@/lib/orders/resolve-lines";
import { isMembership } from "@/lib/memberships";
import type { BuyerDetails } from "@/lib/orders/buyer";
import type { OrderIntentInput, ResolvedLine } from "@/lib/orders/types";
import type { Coupon, DeliveryMethod, PaymentMethod } from "@sailo/db/schema";

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
   * A membership is bought on its own, on whichever rail the shop runs.
   *
   * It used to be card-only, and that was too narrow by a long way. A card
   * gives you *automatic* billing — Stripe holds the card and charges it
   * every period without anybody doing anything — but automatic billing is
   * not what makes something a membership. What makes it one is that it
   * renews: the seller expects money again next month and the member expects
   * to keep getting in. On every other rail Sailo runs that cycle itself,
   * raising the next period's order before the current one lapses, and the
   * seller confirming the payment is what extends it. See
   * `lib/membership-renewals.ts`.
   *
   * Two refusals remain, and both are facts rather than preferences:
   *
   *   Alone, because a card membership's Checkout Session is one Stripe mode
   *   or the other. A basket holding a gym month and a water bottle cannot be
   *   `mode: "subscription"` and cannot be `mode: "payment"` either, so there
   *   is no session that charges it. Kept for manual rails too: a basket that
   *   is half standing arrangement and half one-off sale has no single answer
   *   to "what happens next month", and the buyer would be the one to find
   *   that out.
   *
   *   Without a coupon, because a discount that applies to a recurring charge
   *   has to say for how long, and ours does not. Stripe's subscription
   *   discounts are their own system with their own duration rules; applying
   *   our one-off amount would either discount every month for ever or
   *   silently discount nothing. Said out loud rather than ignored.
   */
  const memberships = lines.filter((line) => isMembership(line.product));
  if (memberships.length > 0) {
    if (lines.length > 1) {
      return {
        ok: false,
        error: "A membership has to be bought on its own. Check out separately.",
      };
    }
    if (!can(shop, "memberships")) {
      return { ok: false, error: "That option isn't available right now." };
    }
    if (input.couponCode?.trim()) {
      return { ok: false, error: "Discount codes don't apply to memberships." };
    }
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
  const canPayInPerson = cartCanPayInPerson(lines.map((line) => line.product));
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
    /*
     * One fee for the order, and only when something in it has to travel: a
     * basket of downloads and appointments is never shipped.
     *
     * The country is the buyer's raw input — the shipping zone is checked
     * against what they actually asked us to post to, not against a value
     * cleaned up later by `readBuyer`, which runs below and cannot run first
     * (it needs the quote to know whether an address is wanted at all).
     * `shipsTo` normalises it itself for exactly this reason.
     */
    resolveDelivery(shop.id, delivered, input.deliveryMethodId, input.country),
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
  /*
   * The shop does not post here.
   *
   * The panel already knows this — it holds every rate's zone and stops
   * offering the ones that don't reach — so a buyer meeting this message has
   * either a page cached from before the seller narrowed a zone, or a request
   * that never went through the panel at all. Both are refused here, because
   * this is the only place that decides.
   *
   * Named for the country rather than a flat "not available": the seller reads
   * this message in a support thread as often as the buyer reads it at
   * checkout, and "we don't ship to Germany" is the sentence that ends the
   * conversation.
   */
  if (delivery === "unserviceable") {
    // The code's proper name when it is one, and otherwise whatever the buyer
    // typed — an older cached form still posts free text, and echoing it back
    // is more use to both sides than "Unknown".
    const code = normalizeCountry(input.country);
    const where = code ? countryName(code, "en") : input.country?.trim();
    return {
      ok: false,
      error: where
        ? `${shop.name} doesn't ship to ${where} yet.`
        : "Choose the country this is being delivered to.",
    };
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
    /*
     * A membership carries no shop tax, and this is where that is decided for
     * every rail at once.
     *
     * The card rail bills a Stripe recurring Price, which is immutable and
     * base-only — minted at `product.priceCents` with no tax component and no
     * `automatic_tax` (Stripe Tax is not provisioned on the connected account).
     * If the quote added an exclusive rate on top, the order would record
     * base+tax while Stripe collected base, and the manual rail — which charges
     * `totals.totalCents` — would collect the tax the card rail silently did
     * not. Dropping it here keeps the shown total, the card charge and the
     * manual charge the same number: the price is the price.
     */
    tax: memberships.length > 0 ? null : shop,
    collectAddress: shop.collectAddress,
    deliveryType: delivery?.type ?? null,
    now,
  });
  const wantsAddress = priced.needsAddress;

  const read = readBuyer(input, {
    def,
    wantsAddress,
    // A download or a ticket needs an inbox to be sent to a second time.
    sendsByEmail: priced.needsEmail,
  });
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
