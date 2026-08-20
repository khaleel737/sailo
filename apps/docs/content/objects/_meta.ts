import type { MetaRecord } from "nextra";

/**
 * `money` first because every other page here refers to it, then the objects
 * in the order their resource pages appear under `/api`.
 *
 * The old ordering put subscriptions and disputes last, with a note saying
 * they were the two with no endpoint at all — reachable only through a
 * webhook. Both have endpoints now, so the distinction the order encoded no
 * longer exists and the order follows `/api/_meta.ts` instead. There is no
 * longer any object here a consumer cannot fetch.
 */
export default {
  index: "Overview",
  money: "Money",
  shop: "Shop",
  order: "Order",
  product: "Product",
  contact: "Contact",
  list: "List",
  subscription: "Subscription",
  dispute: "Dispute",
  booking: "Booking",
  staff: "Staff",
  flow: "Flow",
  "flow-run": "Flow run",
} satisfies MetaRecord;
