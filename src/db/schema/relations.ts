import { relations } from "drizzle-orm";
import { shops } from "./shop";
import { categories, productFiles, productImages, productVariants, products, reviews } from "./catalog";
import { affiliates, coupons, deliveryMethods, paymentMethods } from "./commerce";
import { clients, invoices, orderItems, orders } from "./orders";
import { visits } from "./analytics";
import { user } from "./auth";

/**
 * Every relation, in one file.
 *
 * They cross domains by nature — an order points at a shop, a product and an
 * affiliate — so keeping them here is what stops the table files importing
 * each other in a circle.
 */

export const shopsRelations = relations(shops, ({ one, many }) => ({
  owner: one(user, { fields: [shops.userId], references: [user.id] }),
  products: many(products),
  categories: many(categories),
  orders: many(orders),
  visits: many(visits),
  paymentMethods: many(paymentMethods),
  deliveryMethods: many(deliveryMethods),
  clients: many(clients),
  coupons: many(coupons),
  affiliates: many(affiliates),
  invoices: many(invoices),
}));

export const deliveryMethodsRelations = relations(deliveryMethods, ({ one }) => ({
  shop: one(shops, { fields: [deliveryMethods.shopId], references: [shops.id] }),
}));

export const couponsRelations = relations(coupons, ({ one, many }) => ({
  shop: one(shops, { fields: [coupons.shopId], references: [shops.id] }),
  orders: many(orders),
}));

export const affiliatesRelations = relations(affiliates, ({ one, many }) => ({
  shop: one(shops, { fields: [affiliates.shopId], references: [shops.id] }),
  orders: many(orders),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  shop: one(shops, { fields: [invoices.shopId], references: [shops.id] }),
  order: one(orders, { fields: [invoices.orderId], references: [orders.id] }),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
  shop: one(shops, { fields: [paymentMethods.shopId], references: [shops.id] }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  shop: one(shops, { fields: [clients.shopId], references: [shops.id] }),
  orders: many(orders),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  shop: one(shops, { fields: [categories.shopId], references: [shops.id] }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  shop: one(shops, { fields: [products.shopId], references: [shops.id] }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  images: many(productImages),
  reviews: many(reviews),
  variants: many(productVariants),
  files: many(productFiles),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, {
    fields: [productVariants.productId],
    references: [products.id],
  }),
}));

export const productFilesRelations = relations(productFiles, ({ one }) => ({
  product: one(products, {
    fields: [productFiles.productId],
    references: [products.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, {
    fields: [reviews.productId],
    references: [products.id],
  }),
  shop: one(shops, { fields: [reviews.shopId], references: [shops.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  shop: one(shops, { fields: [orders.shopId], references: [shops.id] }),
  items: many(orderItems),
  deliveryRate: one(deliveryMethods, {
    fields: [orders.deliveryMethodId],
    references: [deliveryMethods.id],
  }),
  product: one(products, {
    fields: [orders.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [orders.variantId],
    references: [productVariants.id],
  }),
  client: one(clients, {
    fields: [orders.clientId],
    references: [clients.id],
  }),
  coupon: one(coupons, {
    fields: [orders.couponId],
    references: [coupons.id],
  }),
  affiliate: one(affiliates, {
    fields: [orders.affiliateId],
    references: [affiliates.id],
  }),
  invoice: one(invoices, {
    fields: [orders.id],
    references: [invoices.orderId],
  }),
}));
