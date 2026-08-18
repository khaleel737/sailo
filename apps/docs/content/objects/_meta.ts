import type { MetaRecord } from "nextra";

/**
 * `money` first because every other page here refers to it, then the four
 * objects the REST API returns, then the two it does not.
 *
 * Subscriptions and disputes are last for a reason worth keeping: they have no
 * endpoint at all and reach a consumer only through a webhook, so a reader
 * arriving from `/api` meets the four they can fetch before the two they
 * cannot.
 */
export default {
  index: "Overview",
  money: "Money",
  shop: "Shop",
  order: "Order",
  product: "Product",
  contact: "Contact",
  subscription: "Subscription",
  dispute: "Dispute",
} satisfies MetaRecord;
