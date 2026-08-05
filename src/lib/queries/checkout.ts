import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { deliveryMethods, paymentMethods, shops } from "@/db/schema";
import { cachedForShop, shopTag } from "@/lib/cache";
import { can } from "@/lib/plans";
import { isRailUsable, type PaymentMethodType } from "@/lib/payments";
import { isDeliveryConfigured, type DeliveryMethodType } from "@/lib/delivery";

/** What a buyer may choose at checkout, and what the seller has configured. */

export async function getShopPaymentMethods(shopId: string) {
  return getDb().query.paymentMethods.findMany({
    where: eq(paymentMethods.shopId, shopId),
    orderBy: [asc(paymentMethods.position)],
  });
}

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

export async function getShopDeliveryMethods(shopId: string) {
  return getDb().query.deliveryMethods.findMany({
    where: eq(deliveryMethods.shopId, shopId),
    orderBy: [asc(deliveryMethods.position)],
  });
}

export async function getCheckoutDeliveryMethods(shopId: string) {
  const rows = await getDb().query.deliveryMethods.findMany({
    where: and(
      eq(deliveryMethods.shopId, shopId),
      eq(deliveryMethods.isEnabled, true),
    ),
    orderBy: [asc(deliveryMethods.position)],
  });
  return rows.filter((d) => isDeliveryConfigured(d.type, d.config));
}

/** Both checkout option lists in the shape the order sheet expects. */
async function readCheckoutOptions(shopId: string) {
  const [payment, delivery] = await Promise.all([
    getCheckoutMethods(shopId),
    getCheckoutDeliveryMethods(shopId),
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
    })),
  };
}

/* -------------------------------------------------------------------------- */
/*  Coupons                                                                    */
/* -------------------------------------------------------------------------- */

export const getCheckoutOptions = cachedForShop(
  ["checkout-options"],
  readCheckoutOptions,
  (shopId) => [shopTag(shopId)],
);

/** The rails and delivery options a buyer may choose from. */
export type CheckoutOptions = Awaited<ReturnType<typeof readCheckoutOptions>>;
