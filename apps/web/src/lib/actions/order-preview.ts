"use server";

import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { liveShop } from "@/lib/shop-visibility";
import { coupons, shops, type Coupon } from "@sailo/db/schema";
import { rateLimit, refundRateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { resolveLines } from "@sailo/commerce/orders/server";
import { resolveDelivery } from "@sailo/commerce/orders/server";
import { cartNeedsDelivery, cartSubtotal, quote } from "@sailo/core/quote";
import { basketWeightGrams } from "@sailo/core/weight";
import {
  checkCoupon,
  COUPON_MESSAGES,
  normalizeCode,
  toChargeableTotals,
} from "@sailo/core/pricing";
import { isMembership } from "@sailo/commerce/memberships";
import { couponAtCurrency } from "@sailo/core/regional";
import { displayCurrency } from "@/lib/regional";
import {
  MAX_QUANTITY,
  cartCanPayInPerson,
  maxOrderable,
  unitsLeft,
} from "@sailo/core/variants";
import type { OrderLineInput, OrderPreview } from "@sailo/commerce/orders";

/**
 * Pricing a basket without committing to it.
 *
 * Split out of `orders.ts` because it is the one action there that writes
 * nothing. It runs on every keystroke in the coupon field, takes no stock,
 * claims no redemption and creates no row — so it is lenient where
 * `createOrderIntent` is strict: a line that has since sold out is dropped
 * from the quote rather than failing it, because the buyer is still shopping.
 */
export async function previewOrder(input: {
  shopId: string;
  items: OrderLineInput[];
  deliveryMethodId?: string;
  couponCode?: string;
  /**
   * Where the buyer says it's going, so a rate they cannot have is not priced
   * into the total they're reading. Optional: most baskets never travel.
   */
  country?: string;
}): Promise<OrderPreview | { error: string }> {
  // Read-only, but it prices a whole basket on every keystroke in the coupon
  // field, so the ceiling is high enough never to reach a real shopper.
  const gate = await rateLimit(`quote:${await callerIp()}`, 120, 60);
  if (!gate.allowed) return { error: "Too many attempts. Wait a moment." };

  const db = getDb();
  const now = new Date();

  const shop = await db.query.shops.findFirst({
    where: liveShop(eq(shops.id, input.shopId)),
    columns: {
      id: true,
      currency: true,
      /*
       * Spec 53. The basket must quote the same currency the storefront quoted
       * and the same one `createOrderIntent` will charge — three answers to
       * "what does this cost" that a buyer sees within one minute of each
       * other, and any disagreement between them is a price they never agreed
       * to. All three ask `displayCurrency`.
       */
      regionalCurrencies: true,
      plan: true,
      subscriptionStatus: true,
      compPlan: true,
      collectAddress: true,
      taxEnabled: true,
      taxName: true,
      taxRateBp: true,
      taxInclusive: true,
      taxOnDelivery: true,
    },
  });
  if (!shop) return { error: "Shop not found." };

  const { currency } = await displayCurrency(shop);
  const money = { currency, shopCurrency: shop.currency };

  const resolved = await resolveLines(shop.id, input.items, {
    strict: false,
    now,
    // The same rounding the order will use, so the total a buyer is quoted is
    // the total they are charged.
    currency,
    shopCurrency: shop.currency,
  });
  if (!resolved.ok) return { error: resolved.error };

  /*
   * What the parcel weighs, so a rate priced by weight prices this basket —
   * spec 51. The same function `quote` uses below and the same one
   * `resolveOrderIntent` uses, so the panel and the checkout choose from the
   * same set of rates.
   */
  const weightGrams = basketWeightGrams(resolved.lines);

  const delivery = await resolveDelivery(
    shop.id,
    cartNeedsDelivery(resolved.lines),
    input.deliveryMethodId,
    input.country,
    money,
    weightGrams,
  );

  let coupon: Coupon | null = null;
  let couponError: string | undefined;
  let couponApplied: string | undefined;

  if (input.couponCode?.trim()) {
    /*
     * A ceiling on *wrong* guesses, separate from the one on quotes.
     *
     * The general quote limit is 120 a minute because the basket re-prices on
     * every keystroke — which also meant 120 coupon guesses a minute, and the
     * reply distinguishes "no such code" from "that code does not apply here".
     * A working discount code is a bearer token: anyone who finds one can
     * spend it.
     *
     * Only a miss costs, and that is the whole design rather than a nicety.
     * Charging every lookup rations the honest buyer hardest: their code stays
     * in the basket, so it is re-checked on every keystroke, quantity change
     * and address edit, and a ceiling of ten was gone in seconds — after which
     * their perfectly good code came back `not_found` and the discount
     * vanished from a checkout they were part-way through. Charging only for
     * codes that do not exist rations the one behaviour that separates
     * guessing from using, and leaves re-quoting a real code free.
     *
     * Paid up front and refunded on a hit, not peeked and charged on a miss.
     * The peek version had a hole precisely where this ceiling aims: a burst
     * of concurrent guesses all read the counter before any of them wrote it,
     * and the whole burst went through a budget of ten. `INCR` first makes the
     * verdict atomic — of any burst, only what the budget covers reaches the
     * lookup — and a real code hands its unit straight back, so the honest
     * buyer's balance never drifts however often the basket re-prices.
     *
     * Answered as `not_found` when tripped, so the ceiling itself says nothing
     * about whether the code was real. A code that exists but does not apply
     * (expired, under minimum) also refunds: existence is the secret being
     * guarded, and the buyer holding such a code is not guessing.
     */
    /*
     * DECISION B — fails closed (existence oracle).
     *
     * A working discount code is a bearer token, and this ceiling is the entire
     * cost of guessing one. Failing open leaves an unmetered oracle over every
     * shop's coupon namespace for as long as Redis is down.
     *
     * The refusal it produces is *not* `not_found`, which every other refusal
     * here is. `not_found` is the right answer when the budget is spent — it
     * says nothing about whether the code exists, which is the point — but it is
     * a lie when nothing was looked up at all: a buyer holding a real code would
     * be told it is invalid. `unavailable` says what actually happened. Rule 5.
     */
    const guessKey = `coupon:${await callerIp()}`;
    const budget = await rateLimit(guessKey, 10, 300, { onOutage: "closed" });

    const code = normalizeCode(input.couponCode);
    // Not looked up at all once the ceiling is reached, so the ceiling costs a
    // query as well as saying nothing.
    const row = budget.allowed
      ? await db.query.coupons.findFirst({
          where: and(eq(coupons.shopId, shop.id), eq(coupons.code, code)),
        })
      : undefined;
    /*
     * Re-read in the basket's currency before the verdict — spec 53, and the
     * same order `resolveCoupon` does it in, so the panel and the checkout
     * cannot disagree about whether a code applies.
     *
     * A code with no price in this currency becomes no code, and therefore
     * `not_found` — the same sentence a code that does not exist gets. The
     * alternative would answer differently for a code that exists, which turns
     * the basket into an oracle for a shop's coupon namespace, which is the
     * exact thing the budget above is protecting.
     */
    const found = row
      ? (couponAtCurrency(row, currency, shop.currency) ?? undefined)
      : row;
    if (found) await refundRateLimit(guessKey, 300);
    // Judged against the whole basket, so a minimum spend counts every line.
    const verdict = checkCoupon(found, cartSubtotal(resolved.lines), now);
    if (budget.reason === "outage") {
      couponError = COUPON_MESSAGES.unavailable;
    } else if (!found) {
      couponError = COUPON_MESSAGES.not_found;
    } else if (verdict.ok) {
      coupon = found;
      couponApplied = code;
    } else {
      couponError = COUPON_MESSAGES[verdict.reason];
    }
  }

  /*
   * A rate that can't be had is a rate that isn't charged for — and that is
   * the whole of this function's response to it.
   *
   * "we don't post to Germany" is a sentence, and a sentence belongs in the
   * panel, in the buyer's own language, next to the country they just picked.
   * Refusing here instead would blank the basket mid-shop over a field they
   * are still filling in, which is exactly the leniency this action exists to
   * provide. The refusal that counts happens in `createOrderIntent`.
   */
  /*
   * `too_heavy` joins the two refusals this line already drops, and for the
   * same reason its own note gives: a rate that cannot be had is a rate that is
   * not charged for, and the sentence about it belongs in the panel next to the
   * basket the buyer is still changing. The refusal that counts happens in
   * `createOrderIntent`.
   */
  const deliveryRate =
    delivery === "unavailable" ||
    delivery === "unserviceable" ||
    delivery === "too_heavy"
      ? undefined
      : delivery;
  // A membership carries no shop tax — see the same decision, and why, in
  // `resolveOrderIntent`. The panel must reach it too, or it would show a tax
  // line on a total the checkout then charges without one.
  const isMembershipBasket = resolved.lines.some((line) => isMembership(line.product));
  const priced = quote({
    lines: resolved.lines,
    coupon,
    deliveryMethod: deliveryRate,
    tax: isMembershipBasket ? null : shop,
    collectAddress: shop.collectAddress,
    deliveryType: deliveryRate?.type ?? null,
    now,
  });

  return {
    // Rounded to the charge step, exactly as `createOrderIntent` rounds the
    // order it writes — so the total the buyer reads here is the one their card
    // is asked for, down to the last fils in the five three-decimal currencies.
    totals: toChargeableTotals(priced.totals, currency, shop.taxInclusive),
    currency,
    tax:
      !isMembershipBasket && shop.taxEnabled
        ? {
            name: shop.taxName,
            rateBp: shop.taxRateBp,
            inclusive: shop.taxInclusive,
            // Read off the priced result rather than re-derived from the shop,
            // so the flag and the zero beside it can only ever agree.
            deferred: priced.totals.taxDeferred,
          }
        : null,
    lines: priced.lines.map((line, index) => ({
      productId: line.productId,
      variantId: line.variantId,
      title: line.title,
      label: line.label,
      kind: line.kind,
      imageUrl: line.imageUrl,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      subtotalCents: line.subtotalCents,
      /*
       * `priced.lines` is built from `resolved.lines` in order, so the index
       * lines up — but a missing entry means the hard cap, not a crash.
       *
       * The same `maxOrderable` the checkout clamps with, so the stepper in
       * the basket cannot offer a quantity the order will quietly reduce.
       */
      unitsLeft: resolved.lines[index]
        ? unitsLeft(resolved.lines[index].product, resolved.lines[index].variant)
        : null,
      maxOrderable: resolved.lines[index]
        ? maxOrderable(resolved.lines[index].product, resolved.lines[index].variant)
        : MAX_QUANTITY,
    })),
    unavailable: resolved.dropped.map((d) => ({
      productId: d.productId,
      variantId: d.variantId ?? null,
    })),
    needsDelivery: priced.needsDelivery,
    needsAddress: priced.needsAddress,
    needsEmail: priced.needsEmail,
    hasService: priced.hasService,
    // Spec 51 — said in the panel, refused in the checkout.
    deliveryTooHeavy: delivery === "too_heavy",
    // A pay-in-person rail is fine unless something in the basket unlocks
    // before payment — an instant download. Computed from the resolved
    // products, which carry `releaseOnPayment`.
    canPayInPerson: cartCanPayInPerson(resolved.lines.map((line) => line.product)),
    couponError,
    couponApplied,
  };
}
