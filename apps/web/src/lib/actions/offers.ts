"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, shops } from "@sailo/db/schema";
import { liveShop } from "@/lib/shop-visibility";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import {
  boughtProductIds,
  offersFor,
  recordShown,
  recordSkipped,
  releaseOfferClaim,
  takeOffer,
} from "@sailo/commerce/orders/server";
import { displayCurrency } from "@/lib/regional";

/**
 * What a buyer is offered after they have paid, and what happens when they take
 * it — spec 36.
 *
 * AFTER THE RECEIPT, NEVER BEFORE IT
 *
 * Baymard found 66% of shoppers made to pass a cross-sell before completing a
 * transaction reported extreme frustration, which is Easytools' own argument
 * for post-purchase placement and it is right. So these load *after* the
 * confirmation has rendered — the buyer's order, files and invoice are on
 * screen before any offer is, and a failure here leaves a receipt rather than a
 * blank page.
 *
 * TAKING ONE IS A NEW ORDER, NEVER AN AMENDMENT
 *
 * Spec 36 is explicit: a new, separately-numbered, re-priced order. Amending a
 * paid order would rewrite an invoice a buyer already has and a tax authority
 * already counted.
 *
 * WHAT IS NOT BUILT HERE, AND WHY IT IS NOT A GAP
 *
 * The instant one-click charge. Spec 36 describes charging the buyer's existing
 * Stripe customer and saved payment method from the original order, and Sailo
 * stores neither — `orders` carries a session id and a payment-intent id, no
 * Checkout Session sets `setup_future_usage`, and there is no card on file
 * anywhere in the product. Building it means consent to store a card, an EU
 * mandate, an SCA fallback when the off-session charge is refused, and a
 * surface for a buyer to see and remove a stored method: a money-path release
 * with its own scenario suite, and not one to bolt onto a thank-you page.
 *
 * The spec names the answer for exactly this case: *"Redirect to a normal
 * checkout where anything is missing — this is the honest default and it must be
 * the fallback for everything."* And it is the fallback for everything else too
 * — a physical good needs an address, a service needs a slot, a membership needs
 * a different Stripe mode, and a manual rail has no stored instrument at all
 * and must never record a paid order nobody has paid.
 */

/** What the thank-you page draws, once the receipt is already on screen. */
export type ThankYouOffer = {
  id: string;
  title: string;
  body: string | null;
  buttonLabel: string | null;
  display: string;
  productSlug: string;
  productTitle: string;
  imageUrl: string | null;
  priceCents: number;
  compareAtCents: number | null;
  currency: string;
};

export async function crossSellsForOrder(input: {
  shopId: string;
  orderId: string;
}): Promise<ThankYouOffer[]> {
  /*
   * Public — the buyer holds an order id and nothing else — so it carries a
   * ceiling. Fails **open**: this runs after a receipt that is already on
   * screen, and a cache outage that blanked the offers costs a seller an upsell
   * rather than costing anybody an answer. Nothing here spends money, takes
   * stock or says whether anything exists that the caller cannot already see.
   */
  const gate = await rateLimit(`offers:${await callerIp()}`, 30, 60);
  if (!gate.allowed) return [];

  const db = getDb();
  const now = new Date();

  const [shop, order] = await Promise.all([
    db.query.shops.findFirst({ where: liveShop(eq(shops.id, input.shopId)) }),
    db.query.orders.findFirst({ where: eq(orders.id, input.orderId) }),
  ]);
  /*
   * The order has to be this shop's. Scoped after the read rather than in it
   * only because both are needed anyway — an id belonging to another shop
   * returns nothing, which is the same answer an id that does not exist gets.
   */
  if (!shop || !order || order.shopId !== shop.id) return [];

  const bought = await boughtProductIds(order);
  const resolved = await offersFor({
    shopId: shop.id,
    placement: "crosssell",
    productIds: bought,
    now,
  });
  if (resolved.length === 0) return [];

  /*
   * The denominator, written when the offers actually render.
   *
   * Take-rate is `taken / shown`, so a seller reading it against anything else
   * is reading a guess. Not awaited into the response: this is analytics behind
   * a receipt, and a failed insert must not be able to blank the offers.
   */
  void recordShown(
    resolved.map((r) => r.offer.id),
    order.id,
  );

  const { currency } = await displayCurrency(shop);

  return resolved.map((r) => ({
    id: r.offer.id,
    title: r.offer.title ?? r.product.title,
    body: r.offer.body,
    buttonLabel: r.offer.buttonLabel,
    display: r.offer.display,
    productSlug: r.product.slug,
    productTitle: r.product.title,
    imageUrl: r.imageUrl,
    priceCents: r.priceCents,
    compareAtCents: r.compareAtCents,
    currency,
  }));
}

export type TakeOfferState =
  /** Go here and buy it. A real checkout, a real new order. */
  | { ok: true; url: string }
  | { ok: false; reason: "expired" | "unavailable" | "already_taken" };

/**
 * The buyer said yes.
 *
 * The claim is taken first and released if the redirect cannot be built, which
 * is the shape the refund race fix used: one-click means double-click, and the
 * unique index on (offer, order) for `taken` is what makes the second tap
 * answer `already_taken` rather than produce a second order.
 *
 * Expiry is re-asked *here*, not only at render — theirs is explicit about it
 * and it is right: a buyer with the page open for an hour must not be able to
 * complete an offer that has closed.
 */
export async function takeCrossSell(input: {
  shopId: string;
  orderId: string;
  offerId: string;
}): Promise<TakeOfferState> {
  const gate = await rateLimit(`offer-take:${await callerIp()}`, 10, 60);
  if (!gate.allowed) return { ok: false, reason: "unavailable" };

  const db = getDb();
  const shop = await db.query.shops.findFirst({
    where: liveShop(eq(shops.id, input.shopId)),
    columns: { id: true, handle: true },
  });
  if (!shop) return { ok: false, reason: "unavailable" };

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, input.orderId),
    columns: { id: true, shopId: true },
  });
  if (!order || order.shopId !== shop.id) {
    return { ok: false, reason: "unavailable" };
  }

  const claimed = await takeOffer({
    shopId: shop.id,
    offerId: input.offerId,
    orderId: order.id,
    now: new Date(),
  });
  if (!claimed.ok) {
    return {
      ok: false,
      reason: claimed.reason === "not_found" ? "unavailable" : claimed.reason,
    };
  }

  /*
   * An ordinary product page, opened on the offer.
   *
   * Not a bespoke one-click checkout: the buyer goes through `resolveLines`,
   * `previewOrder` and `createOrderIntent` exactly as they did the first time,
   * so the price is the seller's, the stock claim is the real one, the address
   * or slot is collected where the product needs one, and the order gets its
   * own invoice number. A cross-sell adds no pricing trust and no second
   * checkout to keep in step.
   *
   * `?offer=` carries the claim forward so the resulting order can be linked
   * back to it, and so a seller's take-rate counts a *sale* rather than a click.
   */
  const url = `/${shop.handle}/p/${claimed.product.slug}?offer=${claimed.offer.id}&from=${order.id}`;
  if (!url) {
    await releaseOfferClaim(claimed.offer.id, order.id);
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, url };
}

/** The buyer said no. Written down, because a skip is data and silence is not. */
export async function skipCrossSell(input: {
  shopId: string;
  orderId: string;
  offerId: string;
}): Promise<void> {
  const gate = await rateLimit(`offer-skip:${await callerIp()}`, 30, 60);
  if (!gate.allowed) return;
  await recordSkipped(input.offerId, input.orderId);
}

/* -------------------------------------------------------------------------- */
/*  The in-cart bump — spec 08                                                 */
/* -------------------------------------------------------------------------- */

/** One bump, as the checkout panel draws it. */
export type BumpOffer = {
  id: string;
  productId: string;
  title: string;
  body: string | null;
  buttonLabel: string | null;
  imageUrl: string | null;
  priceCents: number;
  compareAtCents: number | null;
};

/**
 * What may be offered above the pay button, for this basket.
 *
 * Read-only and priced from the seller's own row. Ticking the tile adds an
 * ordinary basket line, which is re-read and re-priced by `resolveLines` like
 * every other line — so this endpoint carries no pricing trust at all, and the
 * number it returns is a label rather than an amount anybody is charged.
 *
 * No impression is recorded here, and that is deliberate. A bump renders on
 * every re-price of the basket — every quantity change, every keystroke in the
 * coupon field — so counting one per call would inflate `shown` into a number
 * with no relationship to how many people saw it. A bump's take-rate is read
 * from `order_items.via_bump` instead, which counts sales and is what spec 08
 * asked for.
 */
export async function bumpsForBasket(input: {
  shopId: string;
  productIds: string[];
}): Promise<BumpOffer[]> {
  // Read-only and cheap, but it runs on every basket change, so the ceiling is
  // high enough never to reach a real shopper. Fails open, like the quote it
  // rides alongside: nothing here spends money or says whether anything exists.
  const gate = await rateLimit(`bumps:${await callerIp()}`, 60, 60);
  if (!gate.allowed) return [];

  const db = getDb();
  const shop = await db.query.shops.findFirst({
    where: liveShop(eq(shops.id, input.shopId)),
  });
  if (!shop) return [];

  const resolved = await offersFor({
    shopId: shop.id,
    placement: "bump",
    productIds: input.productIds,
    now: new Date(),
    // One at a time. A stack of bumps above a pay button is exactly the
    // friction this placement exists to avoid.
    limit: 1,
  });

  return resolved.map((r) => ({
    id: r.offer.id,
    productId: r.product.id,
    title: r.offer.title ?? r.product.title,
    body: r.offer.body,
    buttonLabel: r.offer.buttonLabel,
    imageUrl: r.imageUrl,
    priceCents: r.priceCents,
    compareAtCents: r.compareAtCents,
  }));
}
