import type { MetaRecord } from "nextra";

/**
 * Ordered by how many people need them, most first.
 *
 * The first four are where the admin's "Learn more" lines land — every seller
 * page ends on one — so they outdraw the rest by construction and open the
 * section.
 */
export default {
  products: "Working with products",
  orders: "Working with orders",
  customers: "Customers and consent",
  payments: "Payments and refunds",
  "no-code": "Zapier, n8n and Make",
  "sync-a-crm": "Syncing to a CRM",
  "membership-access": "Granting and revoking access",
  chargebacks: "Reacting to a chargeback",
  "going-live": "Going live",
} satisfies MetaRecord;
