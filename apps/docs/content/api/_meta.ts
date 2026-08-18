import type { MetaRecord } from "nextra";

/**
 * One page per resource, in the order somebody meets them: prove the key
 * works, then the three things a shop is made of.
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
  openapi: "OpenAPI",
} satisfies MetaRecord;
