import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ShopSocial } from "./json-types";
import { user } from "./auth";

/** The seller's shop, and the Stripe events we have already acted on. */

export const shops = pgTable(
  "shops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Public identity
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    avatarUrl: text("avatar_url"),
    logoUrl: text("logo_url"),

    /**
     * The storefront language the seller pinned, or null to follow whatever
     * the visitor's browser asks for.
     *
     * Nullable on purpose. With a NOT NULL default of "en", a seller who never
     * opened the setting looked identical to one who deliberately chose
     * English — so the Accept-Language branch below it was unreachable and a
     * German visitor arriving from a link got English. Most visitors never
     * find the switcher; the header is the only signal they give us.
     */
    locale: text("locale"),

    // Look & feel — one template, a few knobs
    accentColor: text("accent_color").default("#111111").notNull(),
    theme: text("theme").default("light").notNull(), // light | dark
    layout: text("layout").default("grid").notNull(), // grid | list

    // Contact / ordering
    currency: text("currency").default("USD").notNull(),
    contactEmail: text("contact_email"),
    location: text("location"),

    // Ask for a delivery address on physical products.
    collectAddress: boolean("collect_address").default(true).notNull(),

    // Affiliate programme
    affiliatesEnabled: boolean("affiliates_enabled").default(false).notNull(),
    /** Default commission in basis points — 1000 = 10%. */
    affiliateDefaultBp: integer("affiliate_default_bp").default(1000).notNull(),
    /** Let anyone apply to be an affiliate from the public page. */
    affiliatePublicSignup: boolean("affiliate_public_signup")
      .default(false)
      .notNull(),
    affiliateTerms: text("affiliate_terms"),

    // Billing — see lib/plans.ts for what each tier unlocks
    plan: text("plan").default("free").notNull(), // free | pro | business
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** Stripe's status verbatim: active, trialing, past_due, canceled… */
    subscriptionStatus: text("subscription_status"),
    subscriptionInterval: text("subscription_interval"), // month | year
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),

    /** Everything before this is treated as read in the notification tray. */
    notificationsReadAt: timestamp("notifications_read_at"),
    /** Individually dismissed notification ids. */
    dismissedNotifications: jsonb("dismissed_notifications")
      .$type<string[]>()
      .default([])
      .notNull(),

    /*
     * Card payments, via Stripe Connect. The seller's own account — the charge
     * lands there directly and Sailo never holds the money, so we store an
     * account reference and never their API keys.
     */
    stripeAccountId: text("stripe_account_id"),
    /** Stripe's own verdict; a seller can be connected but not yet payable. */
    stripeChargesEnabled: boolean("stripe_charges_enabled")
      .default(false)
      .notNull(),
    stripeDetailsSubmitted: boolean("stripe_details_submitted")
      .default(false)
      .notNull(),
    /** Country and currency Stripe assigned the account, for display. */
    stripeAccountCountry: text("stripe_account_country"),
    stripeConnectedAt: timestamp("stripe_connected_at"),

    // Invoicing
    invoicePrefix: text("invoice_prefix").default("INV").notNull(),
    invoiceNextNumber: integer("invoice_next_number").default(1).notNull(),
    invoiceNotes: text("invoice_notes"),

    // Tax. Off by default: most link-in-bio sellers are under a registration
    // threshold, and charging tax they don't owe is worse than not charging it.
    taxEnabled: boolean("tax_enabled").default(false).notNull(),
    /** What the buyer sees on the line: VAT, GST, Sales tax, IVA… */
    taxName: text("tax_name").default("Tax").notNull(),
    /** Basis points — 2000 = 20%. */
    taxRateBp: integer("tax_rate_bp").default(0).notNull(),
    /**
     * True where the law expects displayed prices to already include tax (the
     * EU, the UK, most of Asia); false where it's added at checkout (the US).
     */
    taxInclusive: boolean("tax_inclusive").default(false).notNull(),
    /** Shipping is taxable in most places, so this defaults on. */
    taxOnDelivery: boolean("tax_on_delivery").default(true).notNull(),
    /** VAT/GST registration number, printed on the invoice. */
    taxId: text("tax_id"),

    /*
     * Staff-side columns. Written only from /hq — the seller's own admin never
     * touches these, and nothing in it reads them except the suspension notice.
     */
    /**
     * A plan granted by us rather than bought from Stripe: beta users, friends
     * of the house, a support gesture after an outage.
     *
     * Its own column rather than writing `plan` directly, because the billing
     * sync overwrites `plan` and `subscriptionStatus` from Stripe every time
     * the seller opens their billing page — a comp written there would silently
     * evaporate. `planFor` checks this first, so a comp outranks Stripe and
     * survives the sync.
     */
    compPlan: text("comp_plan"),
    /** Why they were comped, so the next person to look knows. */
    compNote: text("comp_note"),
    /** Free-text internal note about the account. Never shown to the seller. */
    staffNote: text("staff_note"),
    /**
     * Set when we take a shop off the air — fraud, abuse, a chargeback ring.
     * Distinct from `isPublished`, which is the seller's own switch and which
     * they can flip back on.
     */
    suspendedAt: timestamp("suspended_at"),
    suspendedReason: text("suspended_reason"),

    // [{ platform: 'instagram', url: '...' }, ...]
    socials: jsonb("socials").$type<ShopSocial[]>().default([]).notNull(),

    isPublished: boolean("is_published").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("shops_handle_key").on(t.handle),
    uniqueIndex("shops_user_id_key").on(t.userId),
    index("shops_stripe_customer_idx").on(t.stripeCustomerId),
    index("shops_stripe_subscription_idx").on(t.stripeSubscriptionId),
  ],
);

/**
 * Every Stripe event we've processed. The webhook is at-least-once, so this
 * makes replays a no-op instead of double-applying a plan change.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: text("id").primaryKey(), // Stripe's event id
    type: text("type").notNull(),
    processedAt: timestamp("processed_at").defaultNow().notNull(),
  },
  (t) => [index("stripe_events_type_idx").on(t.type)],
);
