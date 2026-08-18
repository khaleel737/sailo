import type { shops } from "./shop";
import type { categories, productFiles, productImages, productVariants, products, reviews } from "./catalog";
import type { affiliates, coupons, deliveryMethods, paymentMethods } from "./commerce";
import type {
  clients,
  doorPasses,
  invoices,
  orderItems,
  orders,
  tickets,
} from "./orders";
import type { subscriptions } from "./memberships";
import type { disputes } from "./disputes";
import type { broadcasts } from "./audience";
import type {
  newsletterSubscribers,
  newsletters,
} from "./lifecycle";
import type { staffActions, visitDaily, visits } from "./analytics";
import type {
  creatorReferrals,
  partnerPayouts,
  partners,
  referralEarnings,
} from "./growth";
import type { apiKeys } from "./integrations";
import type { supportTickets } from "./support";
import type { user } from "./auth";

/** Row types, inferred from the tables rather than written twice. */

export type Shop = typeof shops.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductFile = typeof productFiles.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type DoorPass = typeof doorPasses.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Broadcast = typeof broadcasts.$inferSelect;
/** Sailo's own list and its campaigns — the platform side of `Broadcast`. */
export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;
export type Newsletter = typeof newsletters.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type VisitDaily = typeof visitDaily.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type DeliveryMethod = typeof deliveryMethods.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Affiliate = typeof affiliates.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
/*
 * A whole dispute row, unlike the integrations tables above.
 *
 * Three readers hold one in full and none of them can pick columns: the seller
 * notice renders the amount, the deadline and the outcome together, the webhook
 * resource maps most of the table, and /hq shows the case. A narrower type
 * would be re-widened by the second of them.
 */
export type Dispute = typeof disputes.$inferSelect;
export type StaffActionRow = typeof staffActions.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type User = typeof user.$inferSelect;
export type Partner = typeof partners.$inferSelect;
export type PartnerPayout = typeof partnerPayouts.$inferSelect;
export type CreatorReferral = typeof creatorReferrals.$inferSelect;
export type ReferralEarning = typeof referralEarnings.$inferSelect;
/*
 * `ApiKey` alone, not a row type per table in `integrations.ts`.
 *
 * Nothing holds a whole `webhook_endpoints` or `webhook_deliveries` row: the
 * delivery path selects the four columns it needs joined across both, and the
 * settings page selects the ones it renders precisely so `secret` never
 * reaches a client component. A row type for either would be an export with no
 * reader — which `knip` counts, and which would invite the next screen to
 * select everything.
 */
export type ApiKey = typeof apiKeys.$inferSelect;
