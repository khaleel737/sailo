import type { shops } from "./shop";
import type { categories, productFiles, productImages, productVariants, products, reviews } from "./catalog";
import type { affiliates, coupons, deliveryMethods, paymentMethods } from "./commerce";
import type { clients, invoices, orderItems, orders, tickets } from "./orders";
import type { staffActions, visitDaily, visits } from "./analytics";
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
export type Visit = typeof visits.$inferSelect;
export type VisitDaily = typeof visitDaily.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type DeliveryMethod = typeof deliveryMethods.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Affiliate = typeof affiliates.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type StaffActionRow = typeof staffActions.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type User = typeof user.$inferSelect;
