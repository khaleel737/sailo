import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";
import { products, productVariants } from "./catalog";
import { affiliates, coupons, deliveryMethods } from "./commerce";

/** A sale: the buyer, the order, its lines, and the invoice it produced. */

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),

    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),

    notes: text("notes"), // seller's private notes

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("clients_shop_idx").on(t.shopId),
    uniqueIndex("clients_shop_email_key").on(t.shopId, t.email),
    uniqueIndex("clients_shop_phone_key").on(t.shopId, t.phone),
  ],
);

/**
 * An order here is an *intent* — captured the moment a buyer commits, before
 * we hand them off to their chosen rail. The seller keeps the lead even if the
 * buyer never completes the handoff.
 *
 * Customer and product details are snapshotted so the record stays truthful
 * after a client edits their profile or a product is deleted.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),

    /*
     * The first line, repeated on the header.
     *
     * `orderItems` is the authoritative list — these columns exist so a
     * single-item order (still the common case) can be read, searched and
     * summarised without a join, and so rows written before carts existed stay
     * meaningful. `quantity` counts every unit in the order, so on a multi-line
     * order it is deliberately not `subtotalCents / unitPriceCents`.
     */
    productTitle: text("product_title").notNull(),
    /** "Large / Red" — snapshotted so a later rename can't rewrite history. */
    variantLabel: text("variant_label"),
    variantSku: text("variant_sku"),
    /** What kind of thing this was when it sold: physical | digital | service. */
    productKind: text("product_kind").default("physical").notNull(),
    unitPriceCents: integer("unit_price_cents").default(0).notNull(),
    quantity: integer("quantity").default(1).notNull(),
    /** How many lines the order has, so a list can say "and 2 more". */
    itemCount: integer("item_count").default(1).notNull(),
    currency: text("currency").default("USD").notNull(),

    // Money breakdown: total = subtotal - discount + delivery
    subtotalCents: integer("subtotal_cents").default(0).notNull(),
    discountCents: integer("discount_cents").default(0).notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").default(0).notNull(),
    /**
     * Tax snapshot. The rate and name are copied from the shop at order time —
     * a rate change must never rewrite what a past buyer was charged, and an
     * invoice has to keep saying what it said when it was issued.
     */
    taxCents: integer("tax_cents").default(0).notNull(),
    taxRateBp: integer("tax_rate_bp").default(0).notNull(),
    taxName: text("tax_name"),
    /** True when `taxCents` is contained in the total rather than added to it. */
    taxInclusive: boolean("tax_inclusive").default(false).notNull(),
    totalCents: integer("total_cents").default(0).notNull(),

    // Delivery — id for reporting, snapshot so the record survives rate edits
    deliveryMethodId: uuid("delivery_method_id").references(
      () => deliveryMethods.id,
      { onDelete: "set null" },
    ),
    deliveryMethod: text("delivery_method"), // shipping | collection | null for digital
    deliveryLabel: text("delivery_label"),
    pickupLocation: text("pickup_location"),

    // Fulfilment
    trackingCarrier: text("tracking_carrier"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    shippedAt: timestamp("shipped_at"),

    // Booking, for services the buyer scheduled
    scheduledFor: timestamp("scheduled_for"),
    serviceMode: text("service_mode"), // in_person | online
    serviceLocation: text("service_location"),

    /**
     * Digital delivery. The token backs a public download page; the files stay
     * locked until `downloadReleasedAt` is set, which happens on order or on
     * payment depending on the product.
     */
    downloadToken: text("download_token"),
    downloadReleasedAt: timestamp("download_released_at"),
    downloadExpiresAt: timestamp("download_expires_at"),
    /** Snapshot of the product's cap, so tightening it can't strand a buyer. */
    downloadLimit: integer("download_limit"),
    downloadCount: integer("download_count").default(0).notNull(),

    // Refunds — excluded from revenue
    refundedCents: integer("refunded_cents").default(0).notNull(),
    refundedAt: timestamp("refunded_at"),
    refundReason: text("refund_reason"),
    /** Set once cancelled or refunded stock has gone back on the shelf. */
    restockedAt: timestamp("restocked_at"),

    // Email dispatch
    confirmationSentAt: timestamp("confirmation_sent_at"),

    // Coupon snapshot
    /*
     * Card payments. The session is created before the buyer is redirected;
     * the payment intent arrives with the webhook that confirms the money.
     */
    stripeSessionId: text("stripe_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    /** The connected account the charge landed in, for reconciliation. */
    stripeAccountId: text("stripe_account_id"),

    couponId: uuid("coupon_id").references(() => coupons.id, {
      onDelete: "set null",
    }),
    couponCode: text("coupon_code"),

    // Affiliate attribution
    affiliateId: uuid("affiliate_id").references(() => affiliates.id, {
      onDelete: "set null",
    }),
    affiliateCode: text("affiliate_code"),
    commissionCents: integer("commission_cents").default(0).notNull(),
    commissionPaid: boolean("commission_paid").default(false).notNull(),

    // Customer snapshot
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),
    note: text("note"),

    // How they chose to pay
    paymentMethod: text("payment_method").default("whatsapp").notNull(),
    paymentStatus: text("payment_status").default("unpaid").notNull(), // see PAYMENT_STATUSES in lib/payments
    paymentReference: text("payment_reference"), // transfer ref the buyer typed
    paymentProofUrl: text("payment_proof_url"),

    // new | confirmed | shipped | completed | cancelled | refunded
    status: text("status").default("new").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("orders_shop_idx").on(t.shopId),
    // The dashboard asks "this shop, this window" on every load; without
    // the pair it reads the shop's whole history and filters after.
    index("orders_shop_created_idx").on(t.shopId, t.createdAt),
    index("orders_client_idx").on(t.clientId),
    index("orders_created_idx").on(t.createdAt),
    uniqueIndex("orders_download_token_key").on(t.downloadToken),
    // The Connect webhook finds the order by session id, on every card payment.
    index("orders_stripe_session_idx").on(t.stripeSessionId),
  ],
);

/**
 * The lines of an order. Every order has at least one — a "buy now" writes a
 * single row, a cart writes one per product.
 *
 * Everything a line needs to be read years later is copied in, because the
 * product it came from can be edited, re-priced or deleted and the record must
 * still say what was actually sold.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    variantLabel: text("variant_label"),
    sku: text("sku"),
    kind: text("kind").default("physical").notNull(),
    imageUrl: text("image_url"),

    unitPriceCents: integer("unit_price_cents").default(0).notNull(),
    quantity: integer("quantity").default(1).notNull(),
    /** unitPrice × quantity, before any order-level discount or tax. */
    subtotalCents: integer("subtotal_cents").default(0).notNull(),

    // A service books its own slot: two services in one cart are two
    // appointments, not one.
    scheduledFor: timestamp("scheduled_for"),
    serviceMode: text("service_mode"),
    serviceLocation: text("service_location"),

    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_product_idx").on(t.productId),
  ],
);

/**
 * Issued per order with a per-shop sequential number. `token` backs a public
 * link so the buyer can view it without an account.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    number: text("number").notNull(), // e.g. INV-0007
    token: text("token").notNull(),

    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    sentAt: timestamp("sent_at"),
    sentTo: text("sent_to"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("invoices_token_key").on(t.token),
    uniqueIndex("invoices_shop_number_key").on(t.shopId, t.number),
    uniqueIndex("invoices_order_key").on(t.orderId),
    index("invoices_shop_idx").on(t.shopId),
  ],
);

/**
 * One row per appointment a shop currently owes, and the only thing that makes
 * a booking exclusive.
 *
 * `busyFor` reads `order_items` to decide which times are free, and that read
 * is a snapshot: two buyers asking for the same slot in the same second both
 * see it free, both pass the re-derivation at checkout, and both get an
 * appointment the shop cannot keep. Stock does not have this problem because
 * `reserveStock` claims in the statement that reads, and coupons do not
 * because `claimCouponRedemption` does the same. Bookings had no claim at all.
 *
 * A unique index on `order_items(product_id, scheduled_for)` cannot express
 * this: a cancelled or refunded order releases its time, and a partial index
 * there cannot see `orders.status`. So the claim is its own row, taken when
 * the order is written and deleted when the order gives the slot back — which
 * makes "is this time free" a question with one answer at a time, decided by
 * Postgres rather than by whichever request read first.
 */
export const bookingClaims = pgTable(
  "booking_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** The instant the appointment starts, which is what a buyer picked. */
    startsAt: timestamp("starts_at").notNull(),
    /**
     * And when it ends, because overlapping is what double-booked means.
     *
     * A shop can offer a 60-minute service on the half hour, so 09:00–10:00
     * and 09:30–10:30 are both offerable starts and a unique index on the
     * start alone lets two concurrent checkouts take both. The exclusion
     * constraint in `0004` compares ranges instead — half-open, so an
     * appointment ending at 10:00 does not collide with one starting there.
     */
    endsAt: timestamp("ends_at").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * Two orders cannot hold one product at one instant. The overlap rule
     * lives in `booking_claims_no_overlap`, a GiST exclusion constraint that
     * Drizzle's schema language cannot express — see `drizzle/0004`. This
     * index stays because it is the cheap exact-match case and the thing
     * `ON CONFLICT DO NOTHING` can infer.
     */
    uniqueIndex("booking_claims_slot_key").on(t.productId, t.startsAt),
    index("booking_claims_order_idx").on(t.orderId),
  ],
);

/**
 * One row per admission — three tickets bought is three rows, each with its
 * own code, because the person at the door admits people, not orders.
 *
 * Tickets ride the order's own release lifecycle: they are written with the
 * order and become valid when `orders.downloadReleasedAt` is set — the same
 * instant, and the same webhook-retry-safe claim, that opens a digital
 * order's files. A ticket is never its own authority on payment.
 */
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Which line this admission came from; null if the product was deleted. */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    /** What the door sees. Unambiguous alphabet, globally unique. */
    code: text("code").notNull(),
    /** valid | used | void — `used` is claimed atomically, once. */
    status: text("status").default("valid").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("tickets_code_key").on(t.code),
    index("tickets_order_idx").on(t.orderId),
    index("tickets_shop_idx").on(t.shopId),
  ],
);
