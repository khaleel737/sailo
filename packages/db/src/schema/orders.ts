import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";
import { products, productVariants } from "./catalog";
import { affiliates, coupons, deliveryMethods } from "./commerce";
import { policySnapshots } from "./policies";
import type { OrderCustomField } from "./json-types";

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

    /**
     * When this buyer opted in to marketing email, or null if they never have.
     *
     * A date rather than a boolean because consent is a fact with a moment
     * attached — an audit asks *when* it was given, and "true" cannot answer.
     * Granted only, never revoked by omission: a later order that leaves the
     * optional box empty is someone who skipped a box, not someone who
     * withdrew. Withdrawal is unsubscribe, which is spec 14's to build.
     */
    marketingConsentAt: timestamp("marketing_consent_at"),

    /**
     * The seller's own labels for this person: `vip`, `wholesale`, `no-show`.
     *
     * A Postgres array rather than the jsonb `products.tags` uses, because
     * these are what a broadcast's audience is selected by — `tags && '{vip}'`
     * against the GIN index below is an index scan, and the same question
     * asked of jsonb reads every client the shop has. Normalised on the way
     * in by `lib/client-tags.ts`; the column trusts nothing.
     */
    tags: text("tags").array().default([]).notNull(),

    /**
     * How this person got into the list — see `CLIENT_SOURCES`.
     *
     * Defaulted to `order` because that is what every row written before this
     * column existed is, and because it is the only source that can carry
     * consent: a contact typed in or imported from a spreadsheet arrives with
     * `marketingConsentAt` null and stays that way. Consent is a thing a
     * person gave, and a CSV column is a claim that they did.
     */
    source: text("source").default("order").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("clients_shop_idx").on(t.shopId),
    uniqueIndex("clients_shop_email_key").on(t.shopId, t.email),
    uniqueIndex("clients_shop_phone_key").on(t.shopId, t.phone),
    /*
     * GIN, because the question is containment — "which clients carry this
     * tag" — and a btree cannot answer it. See `drizzle/0012`.
     */
    index("clients_tags_idx").using("gin", t.tags),
    /*
     * The signup form's lookup, and it has to be on the folded address.
     * `clients_shop_email_key` indexes the stored casing, so a person
     * subscribing as `Ada@x.com` when the row says `ada@x.com` would miss it,
     * insert, and hit the unique index as an error — turning a second signup
     * into a 500 and, worse, into an oracle that the address was already
     * known. See `drizzle/0016`.
     */
    // `(shop_id, created_at, id)` — the shape every `/api/v1` list pages by.
    index("clients_shop_keyset_idx").on(t.shopId, t.createdAt, t.id),
    index("clients_shop_email_lower_idx").on(t.shopId, sql`lower(${t.email})`),
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

    /*
     * What Stripe Tax decided, for the orders where Stripe decided it.
     *
     * All three are null or false under `taxMode = "manual"`, which is the
     * shape every existing order already has — the flat rate needs nothing
     * recorded beyond `taxRateBp` above, because there was only ever one rate.
     *
     * Under Stripe Tax there is no shop rate to snapshot: the rate came from
     * the buyer's country and the seller's registrations, and `taxRateBp` is
     * back-computed from the amounts so a reader that only knows about the old
     * world still gets a true percentage. These carry the parts of the
     * decision that a percentage cannot express.
     */
    /** The VAT/GST number the buyer gave, as Stripe validated it. */
    buyerTaxId: text("buyer_tax_id"),
    /** Stripe's own type string — `eu_vat`, `gb_vat`, `au_abn`. */
    buyerTaxIdType: text("buyer_tax_id_type"),
    /**
     * The liability moved to the buyer, so this sale carries no tax.
     *
     * Stored rather than inferred from `taxCents = 0`, because zero tax has
     * three different causes — a shop that charges none, a zero-rated product,
     * and this — and only this one obliges the invoice to print the buyer's
     * VAT number beside a notice that the buyer accounts for the tax. A reader
     * that cannot tell them apart puts that notice on invoices that must not
     * carry it, or leaves it off the ones that must.
     */
    taxReverseCharge: boolean("tax_reverse_charge").default(false).notNull(),

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

    /**
     * When it arrived, which is a different fact from when it was sent.
     *
     * `docs/chargebacks.md` states the rule this exists for: on
     * `product_not_received` (Visa 13.1 / MC 4855) *"a tracking number showing
     * 'in transit' is not delivery."* Sailo recorded the carrier, the number,
     * the URL and `shippedAt`, and then had nothing to say about arrival — which
     * is the one thing that reason code turns on.
     *
     * Deliberately **not** a status. `ORDER_STATUSES` stays as it is: three
     * surfaces render status and the enum's own header records what happened
     * last time a copy of it drifted. This is a fact about the parcel;
     * `completed` remains the seller's own workflow mark.
     */
    deliveredAt: timestamp("delivered_at"),
    /**
     * Who says so — `seller` | `buyer_confirmed` | `carrier`.
     *
     * The pack (spec 45) prints this beside the date, because the three are not
     * equally persuasive and presenting a seller's tick as though a carrier said
     * it would be a false claim to a bank. `seller` is the honest default:
     * weaker than a proof of delivery and much stronger than silence.
     * `buyer_confirmed` is the strongest not-received evidence there is — the
     * cardholder's own word, timestamped. `carrier` is reserved for a real
     * integration and ships empty.
     */
    deliveredSource: text("delivered_source"),
    /** The name from a proof of delivery, when there is one. */
    deliverySignedBy: text("delivery_signed_by"),

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
    /**
     * Taken against stock that does not exist yet — spec 33.
     *
     * A flag on the order and not only on the line, deliberately: the seller's
     * list has to show it without a join and the confirmation email has to say
     * it. **Not a different order type and no new status** — a preorder becomes
     * an ordinary fulfilment the day stock arrives, and `ORDER_STATUSES`'s own
     * header records what happened last time a copy of that enum drifted.
     */
    isPreorder: boolean("is_preorder").default(false).notNull(),
    /**
     * What the buyer was promised, as they were shown it.
     *
     * Snapshotted rather than joined: a seller who slips the date next month
     * must not change what this buyer was told today. That is the argument
     * `0035` makes about `shops.termsUrl`, and it is the difference between
     * evidence and a URL — a `product_not_received` case turns on what was
     * *promised* rather than on what was hoped.
     *
     * Null is a preorder with no date given, which is honest and renders as
     * that. It is never a blank.
     */
    preorderExpectedAt: timestamp("preorder_expected_at"),

    /** Set once cancelled or refunded stock has gone back on the shelf. */
    restockedAt: timestamp("restocked_at"),
    /**
     * The seller said this one does not go back on the shelf — spec 51.
     *
     * `restockedAt` records that the units were returned; this records the
     * seller's *decision* not to return them, which is a different fact and the
     * one a refund for a damaged item needs. Asked at the moment they refund,
     * because that is the moment they know.
     *
     * Defaulted false rather than nullable: every refund before this column
     * restocked, and false is what that means. The flag is read *before* the
     * units move, so it cannot be used to explain a restock that already
     * happened.
     */
    restockDeclined: boolean("restock_declined").default(false).notNull(),

    /**
     * The subscription this order is a payment of, if it is one.
     *
     * A column rather than nothing at all, which is what the spec sketched.
     * Every paid invoice writes an ordinary order — that is what keeps Income,
     * the CSV export and the invoice sequence working without any of them
     * learning what a membership is — and "ordinary" is exactly the problem:
     * without this, month four of a gym membership is indistinguishable from
     * somebody buying a mug, so nothing can list a member's payments, skip
     * stock and delivery logic for a renewal, or tell a seller why an order
     * they never saw a checkout for exists.
     *
     * `set null`, because the money is a fact that outlives the arrangement.
     */
    subscriptionId: uuid("subscription_id"),
    /**
     * Stripe's invoice behind a renewal, so a payment can be traced to the
     * thing that charged for it — and so a redelivered `invoice.paid` writes
     * one order rather than a second identical one.
     */
    stripeInvoiceId: text("stripe_invoice_id"),
    /**
     * Which period a *manual* membership payment bought.
     *
     * The idempotency marker for the one path that has no webhook to
     * de-duplicate against: a seller confirming money by hand. Null means the
     * payment has not been counted yet, and `extendForPaidOrder` claims it in
     * a conditional UPDATE — so an order toggled paid → unpaid → paid buys one
     * month rather than three.
     *
     * Deliberately not reusing `stripeInvoiceId` with a made-up value. That
     * column means "Stripe raised this", and a row where it means something
     * else is a row every future reader has to be warned about.
     */
    membershipPeriodEnd: timestamp("membership_period_end"),

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

    /**
     * What this charge put on the buyer's statement, as sent.
     *
     * `unrecognized` (Visa 10.4 / MC 4837) is a cardholder who did not recognise
     * a line on their statement, and `docs/chargebacks.md` says the answer is
     * *"usually a statement-descriptor problem"*. Sailo could not make that
     * argument because it did not know what the buyer saw: whatever the seller's
     * connected account defaults to appeared, and for a link-in-bio shop that is
     * often a legal entity name the buyer has never heard of.
     *
     * A **snapshot**, not a reference to `shops.statementDescriptor`. A seller
     * who changes their descriptor next month must not change what a five-month
     * -old dispute claims the buyer saw.
     */
    statementDescriptor: text("statement_descriptor"),

    /*
     * What the buyer's card statement will say, when that is not what this
     * order says.
     *
     * Adaptive Pricing lets a Dutch buyer pay a EUR amount for a shop that
     * prices in USD — which is the only way they are ever offered iDEAL, since
     * it settles in EUR and nothing else. Stripe converts, and every figure
     * above stays in the shop's own currency: `currency` and `totalCents` are
     * what the seller is paid and what the invoice states, unchanged.
     *
     * These two are the other half of that sentence, and they exist for one
     * question nobody could answer without them — "my statement says €41.23,
     * why does my invoice say $45?". Stripe reports it once, on the session,
     * and it is on no other object we keep.
     *
     * Null is the ordinary case and means what it says: the buyer paid in the
     * shop's currency, so there is no second amount to record. Never read as a
     * money figure in its own right — it is a note about a conversion, not a
     * line in the books.
     */
    presentmentCurrency: text("presentment_currency"),
    presentmentAmountCents: integer("presentment_amount_cents"),

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

    /**
     * What this buyer answered to the shop's own checkout questions, as they
     * were asked.
     *
     * A snapshot and not a join to `contact_field_values`, for the reason
     * `variantSku` beside it is one: an order has to record what was answered
     * at the time even if the field is later deleted, renamed or retyped, and
     * a join would rewrite a March order the day a seller edits a dropdown.
     *
     * Nullable, and the null carries meaning: it is an order placed before
     * this column existed. An order that was asked nothing, or asked and
     * answered nothing, carries `[]` — blank is not absent, and the invoice
     * renders the two differently.
     */
    customFields: jsonb("custom_fields").$type<OrderCustomField[]>(),

    /**
     * Proof this buyer agreed to the shop's terms, or null if the shop wasn't
     * asking. Stamped from the server's clock at order creation and never from
     * anything the client sent — a flag in a request body is a claim, and the
     * whole point of the record is that it isn't one.
     */
    termsAcceptedAt: timestamp("terms_accepted_at"),

    /**
     * *What* they agreed to, beside the `termsAcceptedAt` that records when.
     *
     * Both `set null` rather than cascade: a snapshot is never deleted, and if
     * one ever were, the order has to survive it. The readiness panel already
     * knows how to report a null as `missing`, which is the truth; a page that
     * failed to load would not be.
     */
    termsSnapshotId: uuid("terms_snapshot_id").references(
      () => policySnapshots.id,
      { onDelete: "set null" },
    ),
    refundSnapshotId: uuid("refund_snapshot_id").references(
      () => policySnapshots.id,
      { onDelete: "set null" },
    ),

    /*
     * What the buyer's browser was, recorded so a chargeback can be answered.
     *
     * These three columns are the highest-value thing in this table and they do
     * nothing for the order that carries them. Every fraud rebuttal rests on
     * `buyerIp`; Visa's Compelling Evidence 3.0 requires two of the three, plus
     * two matching prior orders between 120 and 365 days old. Which means the
     * value is realised four months after capture and cannot be backfilled — the
     * buyer's connection existed for the length of one request. A platform that
     * starts recording these today has no fraud defence until December.
     *
     * Taken from the same `callerIp()` the order rate limiter already called, so
     * the capture cost one line. Explicitly *not* identity and never a gate:
     * every value is a header the client can set, and behind a proxy the honest
     * one is whatever that proxy wrote. As evidence that is fine — an issuer is
     * being told what we observed, not what we verified — and as an access
     * control it would be worthless. See `packages/rate-limit/src/client-ip.ts`.
     */
    buyerIp: text("buyer_ip"),
    buyerUserAgent: text("buyer_user_agent"),
    /**
     * A stable per-browser identifier for CE3.0's `customer_device_fingerprint`,
     * which Visa requires to be at least 20 characters.
     *
     * Nullable and expected to stay null for most orders: Sailo redirects to
     * Stripe Checkout and runs no fingerprinting script of its own, so this is
     * filled only where a client already had a durable id to offer. Present as a
     * column because CE3.0 counts it as one of the two matching data points and
     * an order that carries it plus an IP address qualifies on its own.
     */
    buyerDeviceFingerprint: text("buyer_device_fingerprint"),

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
    /*
     * The one index behind every shop-scoped read of this table.
     *
     * `(shop_id, created_at, id)` in exactly that order: the REST and tRPC
     * order lists keyset over `(created_at, id)` under the shop scope, and a
     * row-value cursor is only an index qual while the row's columns line up
     * with consecutive index columns — 0060 added this shape to every other
     * listed table and skipped orders, the highest-write one of the set. The
     * bare `(shop_id)` and `(shop_id, created_at)` indexes this replaces are
     * strict prefixes and were pure write amplification beside it.
     */
    index("orders_shop_keyset_idx").on(t.shopId, t.createdAt, t.id),
    index("orders_client_idx").on(t.clientId),
    index("orders_created_idx").on(t.createdAt),
    /*
     * The seller dashboard's "open tail": undecided orders plus unpaid
     * commission. Partial, so it holds only what the dashboard actually
     * reads — without it, `commission_paid = false` matched every order a
     * no-affiliate shop ever took, and the admin layout aggregated lifetime
     * history on every navigation.
     */
    index("orders_open_tail_idx")
      .on(t.shopId)
      .where(
        sql`${t.status} in ('new', 'confirmed') or ${t.paymentStatus} = 'pending' or (${t.commissionCents} > 0 and not ${t.commissionPaid})`,
      ),
    /*
     * The orders page's status tabs: `count(*) group by status` per view.
     * With the pair this is an index-only scan instead of a heap fetch of
     * the shop's lifetime orders; it also serves the list's status filter.
     */
    index("orders_shop_status_idx").on(t.shopId, t.status),
    /*
     * The affiliate ledgers. `getShopAffiliates`, the partner portal and
     * HQ's affiliate list all join or probe orders by `affiliate_id`, which
     * had no index at all — each probe was a scan of the platform's biggest
     * OLTP table. Partial: almost every order has no affiliate.
     */
    index("orders_affiliate_idx")
      .on(t.affiliateId)
      .where(sql`${t.affiliateId} is not null`),
    /*
     * `GET /api/v1/orders?email=` filters on `lower(customer_email)` under
     * the shop scope — clients got exactly this expression index in 0016 and
     * orders did not, so the filter walked the shop's whole history.
     */
    index("orders_shop_email_lower_idx").on(
      t.shopId,
      sql`lower(${t.customerEmail})`,
    ),
    /*
     * Paid, and nobody has delivered it. The one shape four different callers
     * ask about, and the only one of them that had no index.
     *
     * `EXPLAIN` on HQ's risk desk showed `Seq Scan on orders` — the whole
     * table, on every load of a page staff keep open. It also backs
     * `openObligations`, which refuses an account deletion while buyers are
     * owed goods, and both of the undelivered counts on a closure record.
     *
     * Partial, and that is what makes it cheap: it holds only the rows that
     * are paid and still waiting, which is a small and self-limiting slice —
     * they leave the index the moment somebody ships or refunds. `shopId`
     * leads because every one of the four callers either groups by it or
     * filters on it.
     */
    index("orders_undelivered_paid_idx")
      .on(t.shopId)
      .where(
        sql`${t.paymentStatus} = 'paid' and ${t.status} in ('new', 'confirmed')`,
      ),
    uniqueIndex("orders_download_token_key").on(t.downloadToken),
    // The Connect webhook finds the order by session id, on every card payment.
    index("orders_stripe_session_idx").on(t.stripeSessionId),
    /*
     * One order per Stripe invoice, decided by Postgres.
     *
     * `invoice.paid` is delivered at least once and can arrive under two
     * different event ids for the same invoice, which the `stripeEvents`
     * claim does not cover. Without this a renewal charged once is recorded
     * as two sales — the seller's revenue for the month is simply wrong, and
     * nothing anywhere reports it. Partial, so the millions of rows that are
     * not renewals cost nothing.
     */
    uniqueIndex("orders_stripe_invoice_key")
      .on(t.stripeInvoiceId)
      .where(sql`${t.stripeInvoiceId} is not null`),
    index("orders_subscription_idx").on(t.subscriptionId),
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

    /**
     * This line came from an in-cart bump — spec 08, kept exactly as written.
     *
     * On the *line* and not the order: a basket holding a mug and the bump
     * attached to it is one order with two lines, and only one of them came
     * from the bump. Attributing on the header would credit both, which is the
     * header-versus-lines shape this repo names as recurring.
     *
     * **Set server-side only.** A client flag saying "this was a bump" is a
     * client telling us its own conversion rate.
     */
    viaBump: boolean("via_bump").default(false).notNull(),
    /** Which offer, so take-rate is per offer rather than per feature — spec 36. */
    viaOfferId: uuid("via_offer_id"),

    // A service books its own slot: two services in one cart are two
    // appointments, not one.
    scheduledFor: timestamp("scheduled_for"),
    serviceMode: text("service_mode"),
    serviceLocation: text("service_location"),

    /**
     * Which date of a multi-session event this line bought — spec 50.
     *
     * Null for a single-date event, which is every event today, and for an
     * `all_access` pass — the pass admits every session, so naming one would
     * be a claim on capacity it does not take. Under `pick_one` this is what
     * the seat was claimed against.
     */
    sessionId: uuid("session_id"),
    /**
     * Which price band — spec 50. Null for an event sold at one price.
     *
     * A reference *and* a snapshot: `tickets.tier` still records the name as
     * it read on the night, because a tier renamed or deleted between the
     * on-sale and the door must not change what prints beside somebody's name.
     * This is for the restock path, which has to give the seat back to the
     * band it came from.
     */
    tierId: uuid("tier_id"),

    /**
     * Which bookable person this appointment is with — spec 51.
     *
     * **Null is "any available", which is today's behaviour and stays the
     * default.** A shop with no `staff_resources` rows books exactly as it
     * always has.
     */
    staffId: uuid("staff_id"),
    /** When the buyer moved this themselves — spec 51. The old time. */
    rescheduledFrom: timestamp("rescheduled_from"),

    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_product_idx").on(t.productId),
    /*
     * "Has this person ever bought this product" — the broadcast segment
     * rule — starts from a product and needs the orders it appeared in.
     * Carrying `order_id` in the index makes that an index-only scan instead
     * of a heap fetch per line, which matters because the rule runs once per
     * client the audience query considers.
     */
    index("order_items_product_order_idx").on(t.productId, t.orderId),
  ],
);

/**
 * "Tell me when the blue medium is back" — spec 33.
 *
 * **`variantId` is the subject, not `productId`.** Notifying somebody because
 * the *red* one arrived is the failure that turns a helpful message into a
 * complaint, and it is what this table is shaped to prevent: every read and
 * every notification is keyed on the variant, and the product is here for the
 * join and for the seller's list. Null means the product is sold as one thing,
 * which is why the claim compares with `is not distinct from` rather than `=`.
 *
 * `notifiedAt` is a **claim, not a log**. One notification per request, ever:
 * the row is spent when it is taken, and somebody who wants telling again asks
 * again. A seller who restocks on Monday, sells out by lunch and restocks on
 * Wednesday must not message the same person twice in three days — that is the
 * behaviour that gets a sending domain reported.
 *
 * It is **not** a reservation and nothing about it may imply one. Anybody can
 * buy the restocked unit; being told first is the whole of what was promised.
 *
 * And it is **not a marketing list**. These people asked to be told about one
 * thing; rolling them into `34`'s contacts as subscribers is consent laundering,
 * and the suppression rules in `packages/marketing/src/broadcasts/` exist to
 * prevent exactly it. A separate, explicit opt-in on the same form is fine.
 */
export const stockRequests = pgTable(
  "stock_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Null only for a product sold as one thing. */
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "cascade",
    }),

    email: text("email"),
    /**
     * Accepted, and **Sailo never sends to it**.
     *
     * There is no WhatsApp Business API here and no SMS provider, and
     * pretending otherwise would be a promise the platform cannot keep. A shop
     * running chat rails has buyers who never gave an address, and refusing
     * them a place in the queue is refusing a sale — so the seller's screen
     * lists these with a `wa.me` compose link and they press send from their own
     * number, in a thread the buyer recognises.
     */
    phone: text("phone"),
    /** Where they were standing, for the notification's language. */
    locale: text("locale"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    /** Set when the notification actually went. Null means owed. */
    notifiedAt: timestamp("notified_at"),
  },
  (t) => [
    index("stock_requests_shop_idx").on(t.shopId, t.createdAt),
    /*
     * The two partial unique indexes are in `0039` rather than here, and they
     * have to be: both carry `NULLS NOT DISTINCT`, which drizzle's builder
     * cannot express. Without it the constraint would not fire at all for a
     * product sold as one thing — `variantId` is null there, and a distinct
     * NULL means the same address could be registered a thousand times against
     * one mug.
     */
  ],
);

/**
 * One box, with its own tracking — spec 51.
 *
 * `orders.trackingCarrier` / `trackingNumber` / `shippedAt` are on the order
 * *header*, so a three-item order going out in two parcels could record one
 * tracking number and the buyer chasing the second was told about the first.
 * That is the header-versus-lines shape this repo names as recurring, and this
 * is the fifth place it has turned up.
 *
 * **The header columns stay and go on working.** They are populated from the
 * *first* shipment and treated as a denormalised convenience — the decision
 * spec 51 asks to be written down, taken this way because the buyer's email,
 * the CSV export, the API resource shape, the HQ panel and a dozen tests all
 * read them, and migrating every reader in one pass is a larger and riskier
 * change than keeping one copy that only ever moves forward. Anything wanting
 * the whole picture reads these rows.
 *
 * No new order status. `shipped` when the first shipment goes and `completed`
 * when every line is covered — spec 44 declined to add `delivered` for the same
 * reason, and `ORDER_STATUSES`'s own header records what happened the last time
 * a copy of that enum drifted.
 */
export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /**
     * Denormalised so the seller's "what is in transit" screen needs no join,
     * and so a shipment can be read without its order. The same reasoning
     * `order_messages.shop_id` carries.
     */
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    shippedAt: timestamp("shipped_at").defaultNow().notNull(),

    /**
     * When it actually arrived, and who says so.
     *
     * `shipped` is not `delivered`, and `docs/chargebacks.md` says so in as
     * many words: a tracking number reading "in transit" is not delivery. The
     * source is what separates evidence from an assertion — a carrier scan and
     * a seller ticking a box answer an issuer very differently, and spec 45's
     * fulfilment document prints which one it has.
     */
    deliveredAt: timestamp("delivered_at"),
    deliveredSource: text("delivered_source"), // seller | carrier | buyer

    /** The seller's own note — "front door", "second box of two". */
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("shipments_order_idx").on(t.orderId, t.shippedAt),
    index("shipments_shop_idx").on(t.shopId, t.shippedAt),
  ],
);

/**
 * What went in the box.
 *
 * The composite primary key is the whole of the de-duplication: one order line
 * cannot appear twice in one shipment, so a double-submitted form adds nothing
 * rather than shipping the same three mugs again. The ceiling *across* all of
 * an order's shipments is enforced in the claim, which is a conditional insert
 * — a line can never be shipped more times than it was ordered.
 */
export const shipmentItems = pgTable(
  "shipment_items",
  {
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    quantity: integer("quantity").default(1).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.shipmentId, t.orderItemId] }),
    index("shipment_items_order_item_idx").on(t.orderItemId),
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

    /**
     * Which bookable person this appointment is with — spec 51.
     *
     * **Null is "any available", which is today's behaviour and stays the
     * default**, and it is why the exclusion constraint keys on
     * `COALESCE(staff_id, product_id)` rather than on `staff_id`: Postgres
     * treats `NULL = NULL` as unknown, so a constraint keyed on a null column
     * excludes nothing at all. Every existing shop would have silently lost
     * the guarantee, and the failure would have been a double-booked Saturday
     * rather than an error anybody could see.
     */
    staffId: uuid("staff_id"),
    /**
     * How many of a class's seats this claim holds — spec 51. One is an
     * ordinary appointment, which is every claim that exists today.
     */
    seatsTaken: integer("seats_taken").default(1).notNull(),
    /**
     * Whether this claim owns its time outright.
     *
     * True for a one-at-a-time appointment; false for a seat in a class, where
     * overlapping is the entire point and an exclusion constraint would refuse
     * the second person through the door.
     *
     * On the row rather than derived from `products.bookingCapacity`, because
     * the exclusion constraint is **partial on this column** and a partial
     * index cannot reach into another table to ask. It also snapshots the
     * decision: a seller who turns a one-to-one into a class next month has
     * not retroactively made last month's appointments shareable.
     */
    isExclusive: boolean("is_exclusive").default(true).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * The overlap rule lives in `booking_claims_no_overlap`, a GiST exclusion
     * constraint Drizzle's schema language cannot express — `drizzle/0004`
     * created it on `(product_id, range)` and `drizzle/0046` re-keys it to
     * `(COALESCE(staff_id, product_id), range)`, partial on `is_exclusive`.
     *
     * The old `booking_claims_slot_key` unique index went with it, and its
     * removal is not tidying: `(product_id, starts_at)` is *wrong* under the
     * new key, because two stylists working the same 10:00 slot on the same
     * service are two legitimate claims with one product and one start time.
     * `claimSlots` leaned on it for `ON CONFLICT DO NOTHING` and now catches
     * the exclusion violation instead — the same answer arriving as an error
     * rather than as an empty result.
     */
    index("booking_claims_order_idx").on(t.orderId),
    index("booking_claims_staff_idx").on(t.staffId, t.startsAt),
    /*
     * The public API's diary, which reaches a shop through `products` because
     * this table has no `shop_id`. Without it that join is a sequential scan of
     * every tenant's appointments — the plain btree on `product_id` was dropped
     * in 0046 and its replacement is partial on `WHERE NOT is_exclusive`, which
     * excludes ordinary one-to-one bookings. `created_at, id` follow so the
     * keyset is the same index rather than a sort on top of it.
     */
    index("booking_claims_product_keyset_idx").on(t.productId, t.createdAt, t.id),
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
 *
 * Unless there is no order. A comp, a walk-up and an imported guest list are
 * all issued by the seller directly, which is a stronger claim than a settled
 * payment, so `orderId` is nullable and the door treats null as released —
 * see the note in `drizzle/0014` and the `isNull` branch in `lib/tickets.ts`.
 */
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    /** Null when the seller issued this directly rather than selling it. */
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "cascade",
    }),
    /** Which line this admission came from; null if the product was deleted. */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    /** What the door sees. Unambiguous alphabet, globally unique. */
    code: text("code").notNull(),
    /** valid | used | void — `used` is claimed atomically, once. */
    status: text("status").default("valid").notNull(),
    usedAt: timestamp("used_at"),
    /**
     * Who this admission is for, when that is not simply whoever paid. Null
     * for anything sold through checkout — nothing collects a per-head name
     * there — so the door list falls back to the order's `customerName`.
     */
    attendeeName: text("attendee_name"),
    attendeeEmail: text("attendee_email"),
    /**
     * The tier as it read when the ticket was minted, not a join. Variants
     * get renamed and deleted between the on-sale and the night, and neither
     * may change what is printed beside a name on a past event's door list.
     */
    tier: text("tier"),
    /** order | import | manual — a comp is not a sale, and no count may mix them. */
    source: text("source").default("order").notNull(),
    /** Which door pass admitted them; null means the owner's own session. */
    checkedInBy: text("checked_in_by"),
    /**
     * Which date this admission is for, and which band it was sold in — spec 50.
     *
     * Both alongside the `tier` *text* above rather than replacing it: the text
     * is the snapshot the door list prints and must survive the tier being
     * renamed or deleted, and these are the references the scanner and the
     * restock path resolve.
     */
    sessionId: uuid("session_id"),
    tierId: uuid("tier_id"),
    /**
     * The ticket this one replaced, when a buyer passed it on — spec 50.
     *
     * **Transfer voids the old code and mints a new one.** Not a name change:
     * the old screenshot has to stop working, or two people arrive with one
     * admission and the scanner is right to show amber for both. The chain is
     * what lets a seller see a ticket that has moved three times, which is a
     * resale pattern worth being able to see.
     */
    transferredFromTicketId: uuid("transferred_from_ticket_id"),
    transferredAt: timestamp("transferred_at"),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("tickets_code_key").on(t.code),
    index("tickets_order_idx").on(t.orderId),
    index("tickets_shop_idx").on(t.shopId),
    // Every counter and every door-list page is "this shop, this event, this
    // status", and at five hundred admissions the shop-wide index is not it.
    index("tickets_shop_product_status_idx").on(t.shopId, t.productId, t.status),
    index("tickets_attendee_email_idx").on(t.shopId, t.attendeeEmail),
  ],
);

/**
 * A credential for whoever is actually standing on the door.
 *
 * Until this existed, letting a volunteer scan meant handing them the
 * seller's login — which is also the payouts, the customer list and the bank
 * details. A pass is an unguessable token on a row, the same shape the
 * affiliate portal uses: nothing to create an account for, and revoking is
 * one UPDATE that bites on the next request rather than whenever a session
 * would have expired.
 *
 * Named, because `tickets.checkedInBy` needs something to record. Three
 * volunteers behind one shared credential cannot answer "who let this person
 * in", and that is only ever asked after something has gone wrong.
 */
export const doorPasses = pgTable(
  "door_passes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    /** Null means every event in the shop — a venue running four rooms. */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    token: text("token").notNull(),
    /** A pass that outlives the event is a credential nobody remembers. */
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    lastUsedAt: timestamp("last_used_at"),
    checkInCount: integer("check_in_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("door_passes_token_key").on(t.token),
    index("door_passes_shop_idx").on(t.shopId),
  ],
);

/**
 * One row per event reminder actually sent, and the unique index is what
 * makes "actually" true.
 *
 * The obvious shape is a `reminded24At` column on the order, and it is bug
 * shape number four: an order is a header over lines, so a basket holding
 * two different events would stamp once and the second event's registrants
 * would never hear from anyone. The unit of "already reminded" has to be the
 * same unit as "a thing that starts at a time", which is the line's product.
 *
 * The claim is the insert itself — `onConflictDoNothing().returning()` hands
 * a row to exactly one caller — so two overlapping passes send one email
 * between them rather than one each. Nothing here is read before it is
 * written, which is what makes that true under concurrency.
 */
export const eventReminders = pgTable(
  "event_reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Which pass this was — see `REMINDER_LEADS` in `lib/events-reminders`. */
    lead: text("lead").notNull(),
    /**
     * Which session this reminder was for — spec 50.
     *
     * Null for an event with no sessions, which is all of them today. It is
     * part of the *claim*, so a conference pass reminds once per day rather
     * than once for eight days — see the unique index below.
     */
    sessionId: uuid("session_id"),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * The claim, widened by the session — spec 50.
     *
     * Declared here without its `NULLS NOT DISTINCT`, which drizzle's builder
     * cannot express — `0045` carries the real one, exactly as `0039` carries
     * `stock_requests`'. The modifier is load-bearing rather than decorative:
     * `session_id` is null for every event that has no sessions, which is all
     * of them today, so under the default rule the constraint would not fire
     * for precisely those rows and a single-date event would be reminded once
     * per cron tick for ever.
     */
    uniqueIndex("event_reminders_key").on(
      t.orderId,
      t.productId,
      t.sessionId,
      t.lead,
    ),
  ],
);
