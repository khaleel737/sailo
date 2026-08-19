import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { NotificationPrefs, ShopSocial } from "./json-types";
import type { WeeklyHours } from "./hours";
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

    /* ----------------------------------------------------------------------
       The thank-you page — spec 36

       Fixed copy in 35 locales until now. What it gains is a headline, a body,
       and an optional redirect.
    ---------------------------------------------------------------------- */
    thankYouHeadline: text("thank_you_headline"),
    /** Markdown, through the existing pipeline. Null keeps the default copy. */
    thankYouBody: text("thank_you_body"),
    /**
     * Where the buyer goes afterwards, if the seller wants them to go anywhere.
     *
     * **Opt-in and never default, and the receipt renders first.** A redirect
     * that fires before the buyer has their download link is a lost order and a
     * support ticket — the same reasoning that puts cross-sells after payment
     * rather than during it.
     */
    thankYouRedirectUrl: text("thank_you_redirect_url"),
    /**
     * Seconds to wait. Null or zero is **no redirect however the URL is set**,
     * so clearing the delay switches it off without losing the address.
     */
    thankYouRedirectDelay: integer("thank_you_redirect_delay"),

    // Contact / ordering
    currency: text("currency").default("USD").notNull(),

    /**
     * The other currencies this shop quotes, ISO 4217 uppercase.
     *
     * Presentment only. `currency` above is still the shop's own — what its
     * settings say, what an unmatched visitor is quoted, and what every price
     * falls back to. This is the list a seller ticked, not the list a buyer can
     * actually be quoted: a currency is only offered once **every** published
     * product, priced variant, enabled delivery rate and active coupon carries
     * a price in it. `liveCurrencies` decides that, and the difference is what
     * stops a half-configured currency putting a euro sign in front of a dollar
     * integer.
     *
     * A text array rather than jsonb for the same reason `delivery_methods.
     * countries` is one: the question asked of it is containment.
     *
     * Empty is the default and means today's behaviour exactly — one currency,
     * everywhere.
     */
    regionalCurrencies: text("regional_currencies").array().default([]).notNull(),
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
    /**
     * Where the shop's privacy policy lives, if it has published one.
     *
     * Its own column rather than a second meaning for `termsUrl`, because the
     * two appear in different places and answer different questions: terms is
     * what the buyer *agrees to* at checkout and is snapshotted onto the order
     * when they do, privacy is what the shop must disclose whether or not
     * anybody agrees to anything. One column for both would mean turning on
     * `requireTerms` silently republished the privacy policy as the document
     * being consented to — spec 41.
     *
     * Host-checked on write by the same `isPublicLinkUrl` guard `termsUrl`
     * uses. A page generated in Sailo points at `/[handle]/legal/<slug>`, which
     * is stored absolute so the storefront footer, the checkout and an evidence
     * pack all render one string.
     */
    privacyUrl: text("privacy_url"),

    /**
     * What this shop puts on a buyer's card statement.
     *
     * The fix for `unrecognized` (Visa 10.4 / MC 4837) — a cardholder who did
     * not recognise a line and charged it back. `docs/chargebacks.md` calls it
     * *"usually a statement-descriptor problem"*, and until this column existed
     * Sailo had no answer: whatever the seller's connected account defaults to
     * appeared, which for a link-in-bio shop is often a legal entity name the
     * buyer has never heard of.
     *
     * Two columns because Stripe has two. The descriptor is the fixed part, up
     * to 22 characters; the suffix is appended per transaction where the account
     * supports it. Both validated against the card networks' rules on write —
     * Stripe *silently ignores* an invalid descriptor, which is the worst
     * possible outcome, because it looks configured and is not.
     *
     * Defaulted from `shops.name` on first save. An unconfigured shop showing
     * its own name is still better than one showing an entity nobody knows.
     *
     * Whatever is actually sent is snapshotted onto the order, because this is
     * editable and a five-month-old dispute must not change its story when the
     * seller changes theirs.
     */
    statementDescriptor: text("statement_descriptor"),
    statementDescriptorSuffix: text("statement_descriptor_suffix"),

    /** Show the optional marketing opt-in. Never pre-checked — see the panel. */
    askMarketingConsent: boolean("ask_marketing_consent")
      .default(false)
      .notNull(),

    /*
     * The signup form — the other half of broadcasts, and the half that was
     * missing.
     *
     * A checkout opt-in only reaches people who already bought something, so
     * a shop's mailing list could never grow faster than its sales. This is
     * the form that lets somebody who has bought nothing ask to hear from the
     * shop: a card on the storefront and a shareable page at
     * `/[handle]/subscribe` for a bio link.
     */
    /** Show the signup card on the storefront. The page works regardless. */
    subscribeEnabled: boolean("subscribe_enabled").default(false).notNull(),
    /**
     * What the seller offers for the address — "10% off your first order".
     *
     * Free text and not a coupon reference on purpose: the incentive is a
     * promise made on a public page, and tying it to a code would mean either
     * minting one per subscriber (a table this feature does not need) or
     * printing a shared code where anybody can read it without subscribing.
     * The seller sends the code in the welcome broadcast, where it is earned.
     */
    subscribeIncentive: text("subscribe_incentive"),

    /*
     * Marketing sending, stopped for this shop.
     *
     * Deliberately not `suspendedAt`. That one is a staff decision that takes
     * the whole storefront off the air; this one is narrow and usually
     * automatic — a shop whose complaint or bounce rate crossed the line keeps
     * selling, keeps sending order confirmations, and only stops sending
     * broadcasts. Reusing the suspension column would mean a bounce rate could
     * close a shop, which is not a thing a bounce rate may do.
     *
     * Written by `lib/broadcasts/reputation.ts` when a bounce or complaint
     * webhook pushes the rolling window past a threshold, and cleared from /hq
     * by a human who has looked at the list. Read in `budgetFor`, the one seam
     * every marketing send already passes through.
     */
    marketingPausedAt: timestamp("marketing_paused_at"),
    /** `complaint_rate` | `bounce_rate` | free text when a human paused it. */
    marketingPausedReason: text("marketing_paused_reason"),

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
    /**
     * Where the seller says their business is, asked before the account exists.
     *
     * Not the same column as `stripeAccountCountry` below, and the difference
     * is the whole point of it being here. This is an *input*: the answer to a
     * question put to the seller, which `accounts.create` needs and which
     * Stripe then fixes permanently. That one is an *output*, read back off
     * the account afterwards for display.
     *
     * They exist separately because the input has to be collected while there
     * is still nothing to read. Omitting `country` from `accounts.create` does
     * not defer the question to onboarding — it silently answers it with the
     * *platform's* country, which is how every seller on a US platform ended
     * up with a US account and no European payment method could ever activate.
     *
     * Nullable, and nullable for ever: shops that never take card payments
     * never need it, and asking for a business location before someone has
     * decided to sell is a question with no reason behind it. `connectStripe`
     * is the only thing that requires it, and it asks at the moment it needs it.
     */
    stripeCountry: text("stripe_country"),
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

    /*
     * Who the invoice says the seller is.
     *
     * Separate from the storefront identity above, and separate on purpose.
     * `name` is the trading name a buyer recognises ("Ada's Ceramics") and
     * `location` is the caption under it ("Lisbon, PT"); neither is what a tax
     * authority means by the issuer of an invoice, which is a registered legal
     * entity at a full postal address with a company number.
     *
     * Every column here is nullable and stays nullable. Most sellers on this
     * platform are sole traders under a registration threshold who never need
     * an entity name distinct from their own, and demanding a registered
     * address before someone can sell a $9 preset would be asking a question
     * the law has not asked them yet. `invoiceIdentity` in
     * `packages/core/src/shop/invoice-identity.ts` falls back to the
     * storefront fields when these are unset, so an invoice always has a
     * header and an opted-in seller gets a compliant one.
     */
    invoiceLegalName: text("invoice_legal_name"),
    invoiceAddressLine1: text("invoice_address_line1"),
    invoiceAddressLine2: text("invoice_address_line2"),
    invoiceCity: text("invoice_city"),
    invoiceRegion: text("invoice_region"),
    invoicePostalCode: text("invoice_postal_code"),
    /** ISO 3166-1 alpha-2. Also what decides the seller's own tax country. */
    invoiceCountry: text("invoice_country"),
    /** Companies House number, HRB, SIRET, EIN — distinct from `taxId`. */
    invoiceRegistrationNumber: text("invoice_registration_number"),

    /*
     * Where seller alerts go, when it is not the contact address.
     *
     * An override rather than a kill switch, which is the one place this
     * screen deliberately parts company with the tool it was modelled on.
     * There, an empty field means "send me nothing" — which cannot be the
     * meaning here, because the column ships empty for every shop that already
     * exists and would silence all of their order alerts on deploy. Null means
     * what it meant before the column existed: fall back to `contactEmail`,
     * then to the account's own address. `notificationPrefs` is how an alert
     * gets turned off.
     */
    notificationEmail: text("notification_email"),

    /*
     * Who works out the tax: Sailo's flat rate, or Stripe Tax.
     *
     * `manual` — the rate below, applied to every buyer wherever they are.
     * Correct for the seller who trades in one country and is registered
     * there, which is most of them, and it is the default so nothing changes
     * for anybody who never opens this setting.
     *
     * `stripe` — Stripe Tax computes it at checkout from the buyer's location,
     * the seller's registrations and the product type. `taxRateBp` is then not
     * consulted at all, and the cart shows tax as "calculated at checkout"
     * because it genuinely is not known until Stripe has an address.
     *
     * It runs on the *seller's* connected account, never the platform's. The
     * seller is merchant of record on every Sailo sale — Sailo never touches
     * the money — so the registrations that decide the rate have to be theirs,
     * and the liability follows them.
     */
    taxMode: text("tax_mode").default("manual").notNull(),
    /**
     * Ask a buyer for a VAT/GST number at checkout.
     *
     * Only meaningful under `taxMode = "stripe"`: collecting a VAT number
     * changes nothing unless something is going to validate it and apply the
     * reverse charge, and the flat rate does neither. The settings card hides
     * it in manual mode rather than letting a seller switch on a field that
     * would do nothing.
     */
    taxIdCollection: boolean("tax_id_collection").default(false).notNull(),

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
     * Spec 38 — the four switches on the jurisdictions tab.
     *
     * All four default to today's behaviour, so a shop that never opens the tab
     * is unchanged: no OSS, no automatic country switching, and no product tax
     * category to send Stripe.
     */
    /**
     * The seller files one EU one-stop-shop return rather than registering in
     * each member state.
     *
     * It does not change a rate — under `stripe` the registrations on the
     * connected account decide that, and under `manual` there is one flat rate
     * by definition. What it changes is the *warning*: an OSS-registered seller
     * has already dealt with the €10,000 combined threshold, so the monitor
     * marks the EU row registered instead of mailing them about it.
     */
    taxOssRegistered: boolean("tax_oss_registered").default(false).notNull(),
    /**
     * Stop selling into a country as it approaches a threshold, rather than
     * warning and letting the seller decide.
     *
     * Off by default and deliberately so: the safe-looking default here would
     * silently close a seller's best market while they were asleep. A seller
     * who wants it has usually decided that registering somewhere is more
     * expensive than the sales, which is a judgement only they can make.
     */
    taxDisableOnThreshold: boolean("tax_disable_on_threshold")
      .default(false)
      .notNull(),
    /**
     * Refuse countries that expect registration from the very first sale.
     *
     * A different switch from the one above because it is a different decision:
     * there is no threshold to approach, so nothing will ever warn — the seller
     * is either non-compliant from sale one or not selling there.
     */
    taxDisableImmediateObligation: boolean("tax_disable_immediate_obligation")
      .default(false)
      .notNull(),
    /**
     * The shop-wide product tax category, as Stripe Tax names them
     * (`txcd_10000000` and friends).
     *
     * Meaningful under `taxMode = 'stripe'` and inert under `manual`, where
     * there is one rate applied to everything. The card hides it in manual mode
     * rather than offering a control that does nothing — the same treatment
     * `taxIdCollection` already gets, and for the same reason.
     */
    taxCategory: text("tax_category"),

    /*
     * Booking.
     *
     * `timeZone` is what makes opening hours mean anything: "we open at nine"
     * is a wall-clock time in the seller's own zone, and storing it without
     * one would make every appointment depend on where the server happened to
     * run. UTC is the safe default rather than the right one — onboarding asks.
     */
    timeZone: text("time_zone").default("UTC").notNull(),

    /* ----------------------------------------------------------------------
       Checkout recovery — spec 32
    ---------------------------------------------------------------------- */

    /**
     * Whether an abandoned checkout is followed up at all.
     *
     * Off by default, and deliberately: sessions are *recorded* on every plan
     * from the day this ships, so a seller who switches it on later has
     * history to show — but nothing is sent until somebody chooses to send it.
     */
    recoveryEnabled: boolean("recovery_enabled").default(false).notNull(),
    /**
     * What the recovery mail offers, as a percentage in basis points or a flat
     * amount in minor units. Exactly one may be set; both null is a recovery
     * mail that carries no discount, which is a perfectly good configuration
     * and the safest default.
     */
    recoveryDiscountBp: integer("recovery_discount_bp"),
    recoveryDiscountCents: integer("recovery_discount_cents"),
    /**
     * How often the discount is actually awarded, in basis points.
     *
     * The clever part of their design, and the reason it exists rather than
     * always awarding: **give a recovery discount every time and buyers learn
     * to abandon on purpose.** Default 5000 — a coin flip.
     */
    recoveryDiscountOddsBp: integer("recovery_discount_odds_bp")
      .default(5000)
      .notNull(),
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

    /* ----------------------------------------------------------------------
       Three more, spec 42.

       Ad platforms a seller is already buying from — the id is the receipt for
       spend they made elsewhere, which is what separates these from a named
       analytics vendor. DataFast is refused for exactly that reason: a
       third-party analytics product in our settings is an endorsement and a
       support surface for something we do not run.

       Every one is validated, consent-gated and CSP-scoped through
       `shop-pixels.ts` like the four above. A column here that skipped any of
       the three would be a script-injection point in a `<script>` src.
    ---------------------------------------------------------------------- */
    googleAdsId: text("google_ads_id"),
    /**
     * The conversion label that pairs with the Ads id.
     *
     * Optional beside a set `googleAdsId`, and that is a real state rather
     * than an oversight: a seller may want the remarketing tag running before
     * they have configured a conversion to report against it.
     */
    googleAdsConversionId: text("google_ads_conversion_id"),
    linkedinPartnerId: text("linkedin_partner_id"),
    pinterestTagId: text("pinterest_tag_id"),

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

    /*
     * Payouts held, which is the reversible move that `suspendedAt` is not.
     *
     * Its own column for the same reason `marketingPausedAt` has one: closing a
     * storefront is a staff decision that takes a whole business off the air,
     * and this is narrow, usually automatic, and undone by one API call. A shop
     * on a payout hold keeps selling, keeps taking card payments and keeps
     * accruing a balance — the money simply stays in its own Stripe account,
     * where a chargeback can still be debited from it, instead of leaving on the
     * next scheduled run.
     *
     * That ordering is the whole design. Suspending the storefront stops future
     * orders, which is not where the exposure is: the exposure is the balance
     * about to be paid out. Sailo is the losses collector for these accounts
     * (`payments-compliance.md` §3.2), so money that leaves a seller's balance
     * before their disputes resolve is money Sailo covers and then has to
     * recover under Terms clause 5.
     *
     * Implemented as `settings.payouts.schedule.interval = "manual"` on the
     * connected account, verified against the API in test mode: `payouts_enabled`
     * stays true — the capability is intact — and nothing is scheduled. One
     * update back to `daily` reverses it and the seller may never have noticed.
     */
    payoutsPausedAt: timestamp("payouts_paused_at"),
    /** The figures that tripped it, so the next person can judge whether it was right. */
    payoutsPausedReason: text("payouts_paused_reason"),
    /**
     * The payout interval this shop had before the hold, so releasing it restores
     * what the seller chose rather than assuming daily.
     */
    payoutIntervalBeforeHold: text("payout_interval_before_hold"),

    /**
     * When staff last looked at this shop's disputes and said it was fine.
     *
     * Without it, a cleared shop is re-flagged by the next run of the same
     * arithmetic that flagged it — which is how an automated check teaches
     * everybody to ignore it. The clearance is overridden by new evidence rather
     * than by time: two further chargebacks reopen it. See
     * `CLEARANCE_GRACE_CHARGEBACKS`.
     */
    disputeClearedAt: timestamp("dispute_cleared_at"),
    /** The chargeback count at that moment, which is what "new" is measured from. */
    disputeChargebacksAtClearance: integer("dispute_chargebacks_at_clearance"),
    /**
     * Set by self-serve account deletion. The row itself survives as the
     * retention container for the money ledger — orders and invoices keep
     * their FK home and the invoice sequence stays unbroken — but the shop is
     * tombstoned: unpublished, handle released to `deleted-<id>`, seller PII
     * overwritten. Every public query path excludes it, same as `suspendedAt`.
     */
    deletedAt: timestamp("deleted_at"),

    /**
     * When the 90-day sweep cleared this dead shop's remaining files.
     *
     * Spec 03 deletes a departed seller's images at once and deliberately keeps
     * their product *files*, because a buyer who paid for a download still holds
     * a live token — and taking the file away the moment the seller leaves
     * punishes the wrong person. The cron that finally clears them was a TODO in
     * `api/cron/sweep` from the day that shipped, which left personal data with
     * no deletion path at all. Spec 52 could not honestly promise a statutory
     * erasure on top of that.
     *
     * This column is the *claim*, not a log: the sweep's UPDATE carries
     * `deletedAt < now() - 90 days AND filesSweptAt IS NULL` in its WHERE, so two
     * overlapping ticks list a shop's blobs once. Null on every live shop for
     * ever, which is what makes the partial index on it tiny.
     */
    filesSweptAt: timestamp("files_swept_at"),

    /**
     * The plan this shop was on before a platform chargeback held the downgrade.
     *
     * Spec 46: contesting and downgrading are not exclusive. The existing
     * downgrade on a *lost* platform dispute is correct and keeps working; what
     * changes is that it waits for the case to close where the deadline allows,
     * and a win reinstates. Without this column "reinstate" would put the shop
     * back on whatever the code guessed rather than what they were paying for.
     *
     * Null except while a platform dispute is open against this shop.
     */
    planBeforeDispute: text("plan_before_dispute"),

    /**
     * When this shop stopped being allowed to pay Sailo by card.
     *
     * A second platform chargeback from one customer is not an accident, and
     * re-subscribing by card after one is how the same $64 is lost again. This
     * is a normal risk control and deliberately the *narrow* one: the shop keeps
     * trading, keeps taking card payments from its own buyers, keeps its
     * storefront. All that closes is the rail it pays *us* on. Same graded shape
     * as `payoutsPausedAt` beside `suspendedAt` — the reversible move that a
     * suspension is not.
     *
     * Nothing else is offered in its place, which is the honest position: a
     * customer who has charged back twice is one Sailo does not want a recurring
     * card mandate with.
     */
    cardBillingBlockedAt: timestamp("card_billing_blocked_at"),
    /** The figures that tripped it, so the next person can judge it. */
    cardBillingBlockedReason: text("card_billing_blocked_reason"),

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
    /*
     * The connected account, which three paths look a shop up by and none of
     * them had an index for: `account.updated` mirrors Stripe's capability
     * changes onto the shop, dispute recording resolves the shop when no order
     * matched, and the payout hold reads it back. Each was a sequential scan of
     * every shop on the platform, on a path Stripe retries.
     *
     * Not unique, though it should be: one connected account belongs to one
     * shop, and nothing enforces it. The app database has no duplicates today
     * (checked), so a partial unique index would take — but the scenario suites
     * share one account id across every fixture shop, so adding the constraint
     * means fixing fixtures in suites this change has no business touching.
     * Left as a plain index and recorded here rather than done quietly.
     */
    index("shops_stripe_account_idx").on(t.stripeAccountId),
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
