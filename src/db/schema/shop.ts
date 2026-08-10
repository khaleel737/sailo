import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { NotificationPrefs, ShopSocial } from "./json-types";
import type { WeeklyHours } from "@/lib/booking/hours";
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

    /*
     * Checkout compliance. Both off by default — a seller with no terms to
     * point at is better served by a checkout that doesn't ask than by one
     * that demands agreement to nothing.
     */
    /** Show a required "I agree" checkbox; the server refuses without it. */
    requireTerms: boolean("require_terms").default(false).notNull(),
    /**
     * Where those terms live. Nullable: the checkbox stands on its own when
     * the seller has nowhere to link. Host-checked on write — it is rendered
     * as a link on a public page, so `javascript:` and internal hosts are not
     * things a seller gets to put in front of their buyers.
     */
    termsUrl: text("terms_url"),
    /** Show the optional marketing opt-in. Never pre-checked — see the panel. */
    askMarketingConsent: boolean("ask_marketing_consent")
      .default(false)
      .notNull(),

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
    /**
     * Seller-facing emails the shop has switched off. `{}` means all on —
     * absence of a key is opt-in, so new event types need no backfill.
     */
    notificationPrefs: jsonb("notification_prefs")
      .$type<NotificationPrefs>()
      .default({})
      .notNull(),
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
     * Booking.
     *
     * `timeZone` is what makes opening hours mean anything: "we open at nine"
     * is a wall-clock time in the seller's own zone, and storing it without
     * one would make every appointment depend on where the server happened to
     * run. UTC is the safe default rather than the right one — onboarding asks.
     */
    timeZone: text("time_zone").default("UTC").notNull(),
    /**
     * Seven days, each an array of `{ from, to }` wall-clock windows, so a
     * shop that closes for lunch can say so. Validated by `isWeeklyHours` on
     * the way out: jsonb hands back whatever was written, including by an
     * older build.
     */
    bookingHours: jsonb("booking_hours").$type<WeeklyHours>(),
    /**
     * Minutes between slot starts, when the seller wants them tighter than the
     * service is long — half-hourly starts for a 45-minute treatment. Null
     * means the service's own duration sets the spacing.
     */
    bookingSlotMinutes: integer("booking_slot_minutes"),

    /*
     * The seller's other calendar, read-only.
     *
     * Sailo's exclusion constraint makes a Sailo double-booking impossible,
     * and does nothing at all about the funeral in the seller's own calendar
     * on Tuesday — which is the double booking that actually happens. This is
     * the URL of the read-only feed Google, Apple and Outlook each publish
     * per calendar ("secret address in iCal format"); busy ranges found in it
     * are subtracted from the slots a buyer is offered.
     *
     * A bearer secret in a text column: anyone holding it can read the
     * seller's calendar. It is never sent back to the browser in full — the
     * settings card shows a masked form and the value only ever travels
     * inbound — and it is fetched server-side, so `isCalendarFeedUrl` guards
     * it the way `isStoredFileUrl` guards a file.
     */
    calendarFeedUrl: text("calendar_feed_url"),
    /**
     * When the feed last answered, and what went wrong if it didn't.
     *
     * Both exist because the failure mode here is silent by construction: a
     * feed that stopped parsing hides no slots, and a calendar with nothing
     * in it hides no slots either. Without somewhere to say which happened,
     * the seller's first evidence is a buyer arriving during their funeral.
     */
    calendarFeedCheckedAt: timestamp("calendar_feed_checked_at"),
    calendarFeedError: text("calendar_feed_error"),

    /*
     * The seller's own tracking tags — the Google Analytics property, Tag
     * Manager container and ad pixels for campaigns they run to their page.
     *
     * Bare ids, never markup. The storefront builds each script from a fixed
     * template with the id dropped in, so a seller can configure tracking but
     * cannot inject code into a page we serve to their buyers. The shapes are
     * enforced on the way in *and* on the way out (`lib/shop-pixels.ts`):
     * text columns hand back whatever was written, including by an older
     * build, and these feed script tags.
     *
     * Any of these being set is what puts the consent banner on that
     * storefront — the tags load only after the buyer agrees. All null means
     * the storefront stays as it was: nothing stored, nobody asked.
     */
    ga4MeasurementId: text("ga4_measurement_id"),
    gtmContainerId: text("gtm_container_id"),
    metaPixelId: text("meta_pixel_id"),
    tiktokPixelId: text("tiktok_pixel_id"),

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
    /**
     * Set by self-serve account deletion. The row itself survives as the
     * retention container for the money ledger — orders and invoices keep
     * their FK home and the invoice sequence stays unbroken — but the shop is
     * tombstoned: unpublished, handle released to `deleted-<id>`, seller PII
     * overwritten. Every public query path excludes it, same as `suspendedAt`.
     */
    deletedAt: timestamp("deleted_at"),

    /*
     * This seller's own refer-a-creator code — the `/r/<code>` link they
     * share to bring another creator to Sailo. See `lib/creator-referrals`.
     *
     * Nullable and issued on demand rather than at signup, like the affiliate
     * portal token: a column generated for every shop that ever existed is a
     * backfill and a uniqueness collision risk taken on behalf of the large
     * majority who will never open the card. `ensureReferralCode` mints one
     * the first time the seller looks.
     *
     * Public by design — it appears in every link they post — so nothing may
     * be derived from it and nothing may be read with it. The seller's private
     * earnings are behind their own session, not behind this string.
     */
    referralCode: text("referral_code"),

    // [{ platform: 'instagram', url: '...' }, ...]
    socials: jsonb("socials").$type<ShopSocial[]>().default([]).notNull(),

    isPublished: boolean("is_published").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("shops_handle_key").on(t.handle),
    uniqueIndex("shops_user_id_key").on(t.userId),
    /*
     * Unique, and the lookup `/r/<code>` runs on every click of every
     * referral link anyone has ever posted. Postgres treats NULLs as
     * distinct, so the large majority of shops that never mint a code all
     * coexist under it without a partial-index clause.
     */
    uniqueIndex("shops_referral_code_key").on(t.referralCode),
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
