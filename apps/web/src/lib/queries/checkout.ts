import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { deliveryMethods, paymentMethods, shops } from "@sailo/db/schema";
import { shopTag } from "@/lib/cache";
import { can } from "@sailo/core/plans";
import { deliveryAtCurrency } from "@sailo/core/regional";
import { isRailUsable, type PaymentMethodType } from "@/lib/payments";
import { isDeliveryConfigured, type DeliveryMethodType } from "@sailo/commerce/delivery";
import { blockedCountries } from "@sailo/commerce/tax";
import { countryGateFor } from "@sailo/commerce/tax/server";
import { checkoutFieldsFor } from "@sailo/marketing/contacts/server";

/** What a buyer may choose at checkout, and what the seller has configured. */

export { getShopPaymentMethods } from "@sailo/commerce/shop-views";

/** Only rails a buyer can actually use — enabled and fully configured. */
export async function getCheckoutMethods(shopId: string) {
  const [rows, shop] = await Promise.all([
    getDb().query.paymentMethods.findMany({
      where: and(
        eq(paymentMethods.shopId, shopId),
        eq(paymentMethods.isEnabled, true),
      ),
      orderBy: [asc(paymentMethods.position)],
    }),
    getDb().query.shops.findFirst({ where: eq(shops.id, shopId) }),
  ]);
  if (!shop) return [];

  // A downgrade has to take the card button off the storefront, not just grey
  // it out in admin — the entitlement is checked here, where buyers read it.
  const cardAllowed = can(shop, "cardRails");

  return rows.filter((m) => {
    if (m.type === "card" && !cardAllowed) return false;
    return isRailUsable(m.type, m.config, shop);
  });
}

/* -------------------------------------------------------------------------- */
/*  Delivery                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every delivery method a shop has configured, in the seller's order.
 *
 * `@sailo/commerce/delivery`'s. It was the same four lines here and there —
 * `getCheckoutDeliveryMethods` below is the one that genuinely differs, because
 * it narrows to what a *buyer* may pick.
 */
export { listDelivery as getShopDeliveryMethods } from "@sailo/commerce/delivery/server";

export async function getCheckoutDeliveryMethods(
  shopId: string,
  /**
   * What this visit is quoted in, and the shop's own. Spec 53.
   *
   * A rate with no price in the visitor's currency is **dropped**, not shown at
   * its own currency's number with the wrong symbol on it. `liveCurrencies`
   * already refuses to offer a currency with a gap in it, so this drops nothing
   * in practice — it is the guard for the window between two caches, and the
   * safe side of that window is one delivery option fewer.
   */
  currency?: string,
  shopCurrency?: string,
) {
  const rows = await getDb().query.deliveryMethods.findMany({
    where: and(
      eq(deliveryMethods.shopId, shopId),
      eq(deliveryMethods.isEnabled, true),
    ),
    orderBy: [asc(deliveryMethods.position)],
  });

  const configured = rows.filter((d) => isDeliveryConfigured(d.type, d.config));
  if (!currency || !shopCurrency) return configured;

  return configured
    .map((d) => deliveryAtCurrency(d, currency, shopCurrency))
    .filter((d) => d !== null);
}

/** Both checkout option lists in the shape the order sheet expects. */
async function readCheckoutOptions(
  shopId: string,
  currency: string,
  shopCurrency: string,
) {
  const [payment, delivery, shop, fields] = await Promise.all([
    getCheckoutMethods(shopId),
    getCheckoutDeliveryMethods(shopId, currency, shopCurrency),
    getDb().query.shops.findFirst({
      where: eq(shops.id, shopId),
      columns: { id: true, taxDisableImmediateObligation: true },
    }),
    checkoutFieldsFor(shopId),
  ]);

  return {
    methods: payment.map((m) => ({
      type: m.type as PaymentMethodType,
      label: m.label,
    })),
    deliveryOptions: delivery.map((d) => ({
      id: d.id,
      type: d.type as DeliveryMethodType,
      name: d.name,
      feeCents: d.feeCents,
      freeOverCents: d.freeOverCents,
      estimate: d.config.estimate,
      address: d.config.address,
      hours: d.config.hours,
      /*
       * The zone travels to the browser so the panel can narrow the country
       * list and the rates together, in one frame, without a round trip per
       * keystroke. It is public information — it is the answer to "do you
       * post to me", which is a question any buyer may ask — and it decides
       * nothing: `resolveDelivery` re-checks it against the row when the
       * order is actually placed.
       *
       * Empty means anywhere.
       */
      countries: d.countries,
    })),
    /*
     * Countries this shop will not sell into — spec 38's country control.
     *
     * Sent to the browser so the picker can leave them out, which is the only
     * way a buyer learns the rule by reading rather than by being refused at
     * the end. It decides nothing: `createOrderIntent` reads the same gate from
     * the same rows and refuses a country that arrives anyway, because a server
     * action takes whatever the client sends and a missing `<option>` is not a
     * property of a request.
     *
     * This list rides `shopTag`, so switching a country off has to revalidate
     * it — `updateTaxSettings` does.
     */
    blockedCountries: shop ? blockedCountries(await countryGateFor(shop)) : [],
    /*
     * The shop's own checkout questions — spec 34.
     *
     * Here rather than read by each page, because this is already the one
     * `"use cache"` entry tagged `shopTag(shopId)` that the checkout reads: a
     * seller adding a question revalidates that tag and both mount points pick
     * it up together. A second read somewhere else would be a second thing to
     * remember to revalidate, and the symptom of forgetting is a question the
     * storefront stopped asking with nothing to show for it.
     *
     * `id` is deliberately not sent to the browser. The form answers by *key*,
     * and `saveAnswers` resolves keys against `contact_fields` server-side —
     * so there is no id for a hand-rolled POST to substitute, and no way to
     * name a field belonging to another shop.
     */
    customFields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      options: field.options,
      required: field.required,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/*  Coupons                                                                    */
/* -------------------------------------------------------------------------- */

export async function getCheckoutOptions(
  shopId: string,
  /*
   * Arguments, and therefore part of the cache key. A delivery fee is a price,
   * so an entry cached under one currency cannot be served under another.
   */
  currency: string,
  shopCurrency: string,
) {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return readCheckoutOptions(shopId, currency, shopCurrency);
}

/** The rails and delivery options a buyer may choose from. */
export type CheckoutOptions = Awaited<ReturnType<typeof readCheckoutOptions>>;
