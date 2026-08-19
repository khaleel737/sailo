import type { shops } from "./shop";
import type { shopPages } from "./pages";
import type { dataRequests } from "./privacy";
import type { collectionItems, collections } from "./content";
import type {
  categories,
  eventSessions,
  eventTiers,
  licenseActivations,
  licenseKeys,
  productCodes,
  productFiles,
  productImages,
  productVariants,
  products,
  reviews,
} from "./catalog";
import type { staffResources } from "./booking";
import type { affiliates, coupons, deliveryMethods, paymentMethods } from "./commerce";
import type {
  clients,
  doorPasses,
  invoices,
  orderItems,
  orders,
  shipmentItems,
  shipments,
  stockRequests,
  tickets,
} from "./orders";
import type { subscriptionSeats, subscriptions } from "./memberships";
import type { disputes } from "./disputes";
import type { broadcasts } from "./audience";
import type { checkoutSessions } from "./recovery";
import type {
  automationEmails,
  automationRuns,
  automationSteps,
  automations,
  integrationApps,
} from "./automations";
import type {
  newsletterSubscribers,
  newsletters,
} from "./lifecycle";
import type { staffActions, visitDaily, visits } from "./analytics";
import type {
  creatorReferrals,
  offerEvents,
  offers,
  partnerPayouts,
  partners,
  referralEarnings,
} from "./growth";
import type { apiKeys } from "./integrations";
import type { supportTickets } from "./support";
import type { user } from "./auth";

/** Row types, inferred from the tables rather than written twice. */

export type Shop = typeof shops.$inferSelect;

/* Flows — spec 30. `Automation` is shared with spec 31's scenarios; `kind`
   tells them apart, and one runner serves both. */
/** One checkout a buyer opened — spec 32. */
export type CheckoutSession = typeof checkoutSessions.$inferSelect;

export type Automation = typeof automations.$inferSelect;
export type AutomationEmail = typeof automationEmails.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type AutomationStep = typeof automationSteps.$inferSelect;
/** A place a scenario can send something — spec 31. */
export type IntegrationApp = typeof integrationApps.$inferSelect;
/** One of a seller's five hosted documents — spec 41. */
export type ShopPage = typeof shopPages.$inferSelect;
/** A buyer's subject access, erasure or portability request — spec 52. */
export type DataRequest = typeof dataRequests.$inferSelect;
/** A product's gated content, and one item of it — spec 40. */
export type Collection = typeof collections.$inferSelect;
export type CollectionItem = typeof collectionItems.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductFile = typeof productFiles.$inferSelect;
/** One code out of a pool — spec 48. */
export type ProductCode = typeof productCodes.$inferSelect;
/** A checkable licence, with its own activation limit — spec 48. */
export type LicenseKey = typeof licenseKeys.$inferSelect;
/** One machine a licence is running on — spec 48. */
export type LicenseActivation = typeof licenseActivations.$inferSelect;
/** One price band on one event — spec 50. */
export type EventTier = typeof eventTiers.$inferSelect;
/** One date an event actually runs on — spec 50. */
export type EventSession = typeof eventSessions.$inferSelect;
/** Somebody a buyer can book — spec 51. Not a login; see `booking.ts`. */
export type StaffResource = typeof staffResources.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
/** One box, with its own tracking and its own delivery date — spec 51. */
export type Shipment = typeof shipments.$inferSelect;
/** Somebody waiting for one variant to come back — spec 33. */
export type StockRequest = typeof stockRequests.$inferSelect;
/** A companion product, in-cart or after payment — specs 08 and 36. */
export type Offer = typeof offers.$inferSelect;
export type OfferEvent = typeof offerEvents.$inferSelect;
export type ShipmentItem = typeof shipmentItems.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type DoorPass = typeof doorPasses.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
/** One person on somebody else's subscription — spec 49. */
export type SubscriptionSeat = typeof subscriptionSeats.$inferSelect;
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
