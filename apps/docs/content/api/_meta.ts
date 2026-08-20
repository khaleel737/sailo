import type { MetaRecord } from "nextra";

/**
 * One page per resource, in the order somebody meets them: prove the key
 * works, then the things a shop is made of, then the things that happen to it.
 *
 * The grouping is deliberate. Shop, orders, products and contacts are the
 * nouns every shop has. Lists sits with contacts because it is the other half
 * of the same job — tags say what somebody is, lists say what they get sent.
 * Subscriptions, disputes, bookings and staff come after, because a shop only
 * has them if it sells memberships, takes cards, or books time.
 *
 * `SECTIONS` in `components/reference/endpoints.tsx` decides which operation
 * renders on which of these pages, and `contract.test.ts` fails if an endpoint
 * ever falls outside all of them. This file is only the reading order.
 */
export default {
  index: "Overview",
  shop: "Shop",
  orders: "Orders",
  products: "Products",
  contacts: "Contacts",
  lists: "Lists",
  subscriptions: "Subscriptions",
  disputes: "Disputes",
  bookings: "Bookings",
  staff: "Staff",
  openapi: "OpenAPI",
} satisfies MetaRecord;
