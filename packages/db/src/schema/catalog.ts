import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";
import type { CurrencyPrices, LeadQuestion, ProductOption, VariantOptions } from "./json-types";

/** What a shop sells: categories, products, their variants, files and reviews. */

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("categories_shop_slug_key").on(t.shopId, t.slug),
    index("categories_shop_idx").on(t.shopId),
  ],
);

/**
 * A product is anything the seller uploads — physical goods, a digital file,
 * or a service. The template renders all three identically; what differs is
 * how the order is fulfilled, which the `kind`-specific columns below drive.
 *
 * The price here is the product's base. A product with options prices each
 * combination in `productVariants` and falls back to this when one is blank.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),

    // Minor units (cents) to keep arithmetic exact.
    priceCents: integer("price_cents").default(0).notNull(),
    compareAtCents: integer("compare_at_cents"),

    /**
     * What this costs in the other currencies the shop quotes.
     *
     * `{ "EUR": { "price": 2500, "secondary": 3000 } }` — minor units in
     * *that* currency, decided by `currencyDecimals` and never by a flat 100.
     * `price` is the price charged; `secondary` is the compare-at price struck through beside it.
     *
     * Every number in here was typed by the seller. Nothing converts anything:
     * see `docs/specs/53-regional-pricing.md`. An absent currency is not a zero
     * and not a fallback — it is what makes that currency **not offered at
     * all**, which is the only safe answer when nobody has said what the price
     * should be.
     *
     * `{}` is the default and is what every existing row means.
     */
    currencyPrices: jsonb("currency_prices")
      .$type<CurrencyPrices>()
      .default({})
      .notNull(),

    /* ----------------------------------------------------------------------
       How the price is arrived at — spec 43

       `fixed` is every product ever sold here. `pwyw` is the buyer's own
       number, above a floor the server enforces, and it is the only place in
       the entire checkout where `unitPriceCents` comes from the request.
       `packages/core/src/catalog/pricing-models.ts` holds the clamp; nothing
       else may decide a PWYW amount.

       There is deliberately no `donation` mode and no sixth product kind for
       one. A donation is `pwyw` with a floor of zero on a digital product with
       no file — a pricing difference entirely, and expressing it as a kind
       would fork every `switch` on `ProductKind` in the tree to say something
       none of them are asking about.
    ---------------------------------------------------------------------- */
    pricingMode: text("pricing_mode").default("fixed").notNull(), // fixed | pwyw
    /**
     * The least a buyer may pay, under `pwyw`.
     *
     * **Null and zero are different answers.** Zero is the seller saying "free
     * is allowed" — a donation, a name-your-price download. Null is "not
     * configured", which reads as the list price, so a product switched to
     * PWYW before a floor is typed does not become free the moment the mode
     * changes. Blank ≠ zero, on the column where it costs the most.
     */
    minPriceCents: integer("min_price_cents"),
    /** What the amount field opens on. Null falls back to the list price. */
    suggestedPriceCents: integer("suggested_price_cents"),

    /* ----------------------------------------------------------------------
       When it is on sale — spec 43

       Availability is *computed* from these two instants and never stored: a
       cached `isAvailable` flag drifts the moment a cron misses a tick, and
       the drift is invisible because the product simply goes on selling, or
       stops. An expired window is refused in `resolveLines`, not merely
       hidden — a page opened before expiry must not complete after it.
    ---------------------------------------------------------------------- */
    sellFrom: timestamp("sell_from"),
    sellUntil: timestamp("sell_until"),
    /**
     * Whether a closed window takes the product off the grid, or leaves it
     * there reading as unavailable.
     *
     * Both are wanted and neither is obviously the default. An ended launch is
     * very often exactly where the back-in-stock form should live (spec 33),
     * and a page that 404s loses the buyer along with the link they followed.
     */
    hideWhenUnavailable: boolean("hide_when_unavailable").default(false).notNull(),

    kind: text("kind").default("physical").notNull(), // physical | digital | service | event | membership
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),

    /**
     * The seller's own code for this product, for a product sold as one thing.
     *
     * `productVariants.sku` already carries one per combination, and the order
     * line snapshots whichever applies into `orders.variantSku` — so a shop
     * whose catalogue has no options had a column for the code on the order
     * and nowhere to type it. This is that missing half.
     */
    sku: text("sku"),

    /**
     * The most units one order may take, regardless of what is in stock.
     *
     * Not a stock column: stock says how many exist, this says how many one
     * person is allowed at once. The two answer different questions and a
     * ticketed event needs both — a room of 200 that also refuses to sell
     * anybody more than four seats. Null is no cap beyond stock, which is
     * what every product created before this column had.
     *
     * Enforced in `maxOrderable`, so the picker, the basket and the order all
     * read one rule; the checkout clamps against it server-side because a
     * quantity arrives from a browser.
     */
    maxPerOrder: integer("max_per_order"),

    /**
     * This product's Stripe Tax category, overriding the shop's.
     *
     * Ebooks, printed books, children's clothes and food are rated differently
     * from everything else in most of the EU, and a shop selling one alongside
     * ordinary goods cannot express that with a single shop-wide setting.
     *
     * Null means "use the shop's", which is what every existing product means,
     * and inert under `taxMode = 'manual'` where there is one rate for
     * everything. Never a rate of its own: a category is an input Stripe reads,
     * and a percentage typed here would be Sailo deciding a tax treatment.
     */
    taxCategory: text("tax_category"),

    /**
     * The questions a `lead` product asks instead of selling anything.
     *
     * `[{ id, label, required }]`, and empty for every other kind — which is
     * what every existing product means, so the column changes nothing until a
     * seller makes a lead magnet. Never a price and never a payment: a lead
     * product's whole checkout is this list plus a name and an address.
     */
    leadQuestions: jsonb("lead_questions")
      .$type<LeadQuestion[]>()
      .default([])
      .notNull(),

    /**
     * What the buyer chooses between: [{ name: "Size", values: ["S","M","L"] }].
     * Empty for a product sold as one thing. The sellable combinations live in
     * `productVariants` — this is only the shape of the choice.
     */
    options: jsonb("options").$type<ProductOption[]>().default([]).notNull(),

    /**
     * Count units down as orders arrive instead of relying on the manual
     * `inStock` switch. Stock lives on the variant when there are options.
     */
    trackInventory: boolean("track_inventory").default(false).notNull(),

    /**
     * Whether an abandoned checkout for this product is followed up — spec 32.
     *
     * **Nullable, and the null is the point: it means inherit the shop.**
     * Blank is not false. `false` is a seller switching recovery off for this
     * one product with the shop's setting left on; `null` is a product that
     * has never been asked, which is every product that existed before this
     * column did. Collapsing the two would turn "I haven't decided" into "no",
     * silently, across an entire catalogue — the blank-vs-zero shape, on a
     * path where the symptom is revenue that quietly stops being recovered.
     */
    recoveryEnabled: boolean("recovery_enabled"),
    /** Units left, for a product with no options. Null while untracked. */
    stockQuantity: integer("stock_quantity"),

    /* ----------------------------------------------------------------------
       Running a stockroom — spec 51 (physical half)
    ---------------------------------------------------------------------- */

    /**
     * Tell the seller when stock falls to this. Null is no alert, which is
     * every product that existed before this column.
     *
     * On the product rather than per variant on purpose: a seller with a shirt
     * in twelve combinations wants to know their stockroom is running low, not
     * to receive twelve emails. The alert names which combinations are short.
     */
    lowStockThreshold: integer("low_stock_threshold"),
    /**
     * The claim, not a log — one email per downward crossing.
     *
     * Set in the same conditional UPDATE that reads the count, so a seller
     * adjusting stock in a spreadsheet-like screen crosses the threshold five
     * times in a minute and hears once. **Reset to null when stock rises back
     * above the threshold**, or a single restock-and-resell cycle goes silent
     * for ever — which is worse than never having built it.
     */
    lowStockNotifiedAt: timestamp("low_stock_notified_at"),

    /**
     * What is in the box, so shipping can be priced by it — spec 51.
     *
     * Grams and millimetres as integers, for exactly the reason money is in
     * minor units: a float weight compared against a band boundary is a
     * rounding argument with a carrier. No unit picker — a seller who thinks in
     * ounces is served by a label, not by a second stored unit that every
     * reader then has to convert.
     */
    weightGrams: integer("weight_grams"),
    lengthMm: integer("length_mm"),
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),

    /* ----------------------------------------------------------------------
       Selling what there is none of — spec 33

       A buyer who finds the blue medium sold out has two useful answers, and
       these are the second: buy it now, against stock that does not exist yet,
       with a date they were shown *first*.

       Charged at checkout like any other order — the ordinary commerce answer,
       and what every Shopify preorder does. What that buys is a duty rather
       than machinery, and `preorderExpectedAt` is the whole of it.
    ---------------------------------------------------------------------- */
    preorderEnabled: boolean("preorder_enabled").default(false).notNull(),
    /**
     * What the buyer is told before they commit.
     *
     * **Null means "no date given"**, which is honest and must render as that
     * rather than as a blank: a card payment for goods that arrive six weeks
     * later is a chargeback waiting to happen if the buyer was never told six
     * weeks. Snapshotted onto the order at checkout, so a seller who slips the
     * date next month does not change what this buyer was promised today.
     */
    preorderExpectedAt: timestamp("preorder_expected_at"),
    /**
     * A ceiling on preorders, separate from stock. Null is uncapped.
     *
     * Claimed by counting open preorders for the variant inside the statement
     * that takes one, never a read followed by a write — a seller who can make
     * fifty must not be able to sell fifty-three because three buyers arrived
     * in the same second.
     */
    preorderLimit: integer("preorder_limit"),

    // Digital goods
    /**
     * What a digital order actually hands over: `file`, `link` or `code`.
     *
     * A download is only one of the three things sellers mean by "digital".
     * The other two were being sold as files that did not exist — a course on
     * someone else's platform, a Discord invite, a licence key — so the
     * product was publishable, orderable, and delivered nothing.
     *
     * One of the three rather than all of them at once, and deliberately: a
     * buyer who is handed a file, a link *and* a code has to work out which of
     * them is the thing they bought. The seller picks the shape of the good
     * once; `releaseOnPayment` below gates all three identically, because they
     * are the same promise made three ways.
     */
    digitalDelivery: text("digital_delivery").default("file").notNull(),
    /**
     * Where the buyer goes, under `digitalDelivery: "link"`.
     *
     * Held back until the order is released exactly as a file is. It is the
     * whole good, so putting it in the confirmation email of an unpaid order
     * gives the good away — the same reasoning, and the same gate, as
     * `eventJoinUrl` further down.
     */
    digitalLinkUrl: text("digital_link_url"),
    /**
     * The licence key, invite code or joining instructions, under
     * `digitalDelivery: "code"`.
     *
     * Free text rather than a pool of one-per-buyer codes. A pool is a
     * different product with its own inventory story — codes run out, an order
     * has to reserve one, a refund has to give it back — and half of one would
     * be worse than neither. What this is for is the case that is genuinely
     * one string: a Discord invite, a workshop's Zoom password, a coupon at a
     * partner shop.
     */
    digitalAccessDetails: text("digital_access_details"),
    /**
     * Where the code under `digitalDelivery: "code"` actually comes from —
     * spec 48.
     *
     * NULL is `digitalAccessDetails` above, the one shared string, and it is
     * every product that existed before this column. `pool` draws one row per
     * buyer from `product_codes`; `generated` mints one per buyer from
     * `codePattern`.
     *
     * NULL rather than a defaulted `"shared"` because the whole point is that
     * an untouched product keeps behaving as it did, and a default would have
     * to be written to every row in the table to say so.
     *
     * `link` delivery gets pools too. A Notion duplicate link or a one-seat
     * invite URL is a code that happens to be a URL, and it is the same
     * scarcity problem: one string handed to two hundred buyers is the product
     * given away.
     */
    codeSource: text("code_source"),
    /**
     * The shape of a minted code, under `codeSource: "generated"`.
     *
     * `SAILO-XXXX-XXXX-XXXX` — every `X` becomes a Crockford base32 character
     * and everything else is literal. Validated at the write against two
     * rules: enough `X`s to be unguessable, and a folded length that no ticket
     * or member pass can produce. See `codePattern` in `@sailo/core/codes`.
     */
    codePattern: text("code_pattern"),
    /**
     * Whether this product mints a checkable licence key per buyer — spec 48.
     *
     * A code pool serves anyone handing out a string; this serves the seller
     * whose *software* has to ask whether a string is still good. The public
     * activate/validate/deactivate endpoints are the surface, and they are
     * deliberately outside the authenticated API: the licence key is the
     * credential, because requiring the seller's API key would put it in every
     * customer's binary.
     */
    licenseEnabled: boolean("license_enabled").default(false).notNull(),
    /** Machines one key may run on at once. Null is unlimited. */
    licenseActivationLimit: integer("license_activation_limit"),
    /** Licence length in days. Null never expires. */
    licenseDays: integer("license_days"),
    /**
     * Hold the files until the seller confirms payment. On by default: every
     * rail here settles out of band, so releasing on order would hand the file
     * to anyone willing to click through checkout.
     */
    releaseOnPayment: boolean("release_on_payment").default(true).notNull(),
    /** Downloads allowed per order. Null is unlimited. */
    downloadLimit: integer("download_limit"),
    /** Days the buyer's link stays alive. Null never expires. */
    downloadExpiryDays: integer("download_expiry_days"),

    // Services
    durationMinutes: integer("duration_minutes"),
    serviceMode: text("service_mode").default("in_person").notNull(), // in_person | online
    /** Where to turn up, or how the call is joined. */
    serviceLocation: text("service_location"),
    /** Ask the buyer for a preferred date and time at checkout. */
    bookingEnabled: boolean("booking_enabled").default(false).notNull(),
    /** Notice the seller needs — the picker won't offer anything sooner. */
    bookingLeadHours: integer("booking_lead_hours").default(24).notNull(),
    /**
     * How many people one slot holds — spec 51. NULL is 1, which is today.
     *
     * A yoga class of twelve, a workshop of six, a tour of twenty could not be
     * sold at all: `durationMinutes` plus one slot was one buyer.
     *
     * A class is close to an event session (spec 50) and deliberately not the
     * same thing: a session is a fixed datetime the seller published, a class
     * slot is *generated from hours*. Where a seller wants fixed dates, `event`
     * with sessions is the right kind, and the product form says so.
     */
    bookingCapacity: integer("booking_capacity"),
    /**
     * How close to the appointment a buyer may still move it themselves.
     * NULL is not allowed at all, which is today's behaviour.
     *
     * Today a buyer who needs to move a haircut emails and the seller does it
     * by hand. The link is the signed-token pattern `disputes/arrival.ts` and
     * `broadcasts/unsubscribe.ts` already use — no account, no row written at
     * send time, works from a cold mail client months later.
     */
    rescheduleCutoffHours: integer("reschedule_cutoff_hours"),
    /** The same for cancelling, which releases the slot and tells the waitlist. */
    cancelCutoffHours: integer("cancel_cutoff_hours"),
    /**
     * Quiet minutes either side of an appointment.
     *
     * The gap to clean the room, write the notes, drive to the next one. The
     * calendar offered slots that butted straight up against each other, so a
     * seller with a full day had no minute between two of them that was not
     * already sold — and nothing on the form could say otherwise.
     *
     * Applied by widening what counts as busy rather than by lengthening the
     * appointment: the buyer books the hour they are paying for, and the
     * fifteen minutes after it simply stop being offered to anybody else.
     * Widening in the *display* direction is also the safe direction — it can
     * only ever offer fewer slots than the exclusion constraint would accept,
     * never more.
     */
    bookingBufferMinutes: integer("booking_buffer_minutes").default(0).notNull(),

    // Events
    /**
     * When the doors open, for `kind: "event"`. This is the moment ticket
     * sales close: a ticket sold after the start would be one for an event
     * already happening. Venue reuses `serviceLocation` above, and capacity
     * is ordinary stock — the guarded decrement is what stops overselling
     * a room, exactly as it stops overselling a shelf.
     */
    eventStartsAt: timestamp("event_starts_at"),
    /**
     * When it is over. Optional, because plenty of events have no fixed end.
     *
     * It does not gate anything — sales close at `eventStartsAt` and that is
     * unchanged. What it does is let the buyer's page and their calendar say
     * "19:00 – 22:00" instead of "19:00", which is the difference between an
     * event somebody can plan around and one they cannot.
     */
    eventEndsAt: timestamp("event_ends_at"),
    /**
     * Where an online event is joined — a Zoom, Meet or Teams link the seller
     * pastes, or anything else that is a URL.
     *
     * Held back until the order is released. It is the whole good being sold,
     * so putting it in the confirmation email of an unpaid order is giving
     * the event away to anyone willing to click through checkout; the gate is
     * `orders.downloadReleasedAt`, the same timestamp that unlocks a digital
     * order's files and validates a ticket. `serviceMode` decides whether an
     * event is online at all, exactly as it does for a service.
     */
    eventJoinUrl: text("event_join_url"),

    /* ---- Event depth — spec 50 ------------------------------------------- */

    /**
     * How a buyer meets an event's dates. NULL is single, which is today.
     *
     * `pick_one` — the buyer chooses a session (a class on Tuesday *or*
     * Thursday). `all_access` — the ticket admits every session (a conference
     * pass). The distinction decides which capacity a purchase claims, and it
     * is the only thing that does: under `pick_one` a line claims the
     * *session's* seats, under `all_access` the product's.
     */
    sessionMode: text("session_mode"),
    /**
     * Ask for each attendee's name at checkout — spec 50.
     *
     * `tickets.attendeeName` and `attendeeEmail` existed and nothing collected
     * them, so four tickets bought together were four rows carrying the
     * purchaser's own details and the door list was one name four times.
     *
     * An attendee address is **not** a marketing contact: consent is a thing a
     * person gave, and the purchaser cannot give it for their guest. `clients`
     * is never written from an attendee row.
     */
    collectAttendeeDetails: boolean("collect_attendee_details")
      .default(false)
      .notNull(),
    /**
     * online | in_person | hybrid. NULL falls back to `serviceMode`, which is
     * what every event decided by before this column.
     */
    eventMode: text("event_mode"),
    eventVenueName: text("event_venue_name"),
    eventAddress: text("event_address"),
    /**
     * The event's own zone, falling back to `shops.timeZone`.
     *
     * **Per event, not per shop.** A seller in Dubai running a webinar for a
     * London audience is the normal case, and `shops.timeZone` — which exists
     * so opening hours mean anything — is the wrong answer for it. The buyer
     * sees their own clock with the event's zone named beside it, which
     * prevents more support mail than any other line in spec 50.
     */
    eventTimeZone: text("event_time_zone"),
    /**
     * The seller's refund terms for this event, in their own words.
     *
     * Disclosed at checkout and snapshotted onto the order, because
     * `refund_policy_disclosure` is a real Stripe evidence field and a policy
     * nobody was shown is a policy that loses a dispute.
     */
    eventRefundPolicy: text("event_refund_policy"),
    /** Hours before the start after which nothing may be cancelled. */
    eventRefundCutoffHours: integer("event_refund_cutoff_hours"),
    /**
     * Whether a buyer may release their own seat inside the cutoff.
     *
     * Off by default, which is today. When on, a cancellation puts the
     * capacity back through the same conditional-UPDATE restock path the sweep
     * uses, and notifies spec 33's waitlist — a released seat nobody is told
     * about is a lost sale.
     */
    eventAllowSelfCancel: boolean("event_allow_self_cancel")
      .default(false)
      .notNull(),

    /* ----------------------------------------------------------------------
       Memberships

       A product the buyer keeps paying for — a gym month, a club, a course
       with a monthly fee. `priceCents` is the price *per interval*, which is
       why no new price column exists: one price meaning two things would be
       the first thing to drift.
    ---------------------------------------------------------------------- */

    /**
     * `day`, `week`, `month` or `year`, for `kind: "membership"`. Null for
     * everything else.
     *
     * Stripe's four recurring intervals, all four of them, because "monthly or
     * yearly" is a guess about what sellers charge rather than a constraint
     * anything imposed. A weekly class and a quarterly subscription box are
     * both ordinary businesses and neither could be sold here.
     */
    billingInterval: text("billing_interval"),
    /**
     * How many of them per charge — the `3` in "every 3 months".
     *
     * Separate from the interval rather than folded into it (no `quarter`,
     * no `fortnight`) because that is exactly Stripe's model, and inventing
     * our own names for the combinations would mean translating them back at
     * the boundary. One is the overwhelming case and the default, so every
     * membership that existed before this column keeps billing identically.
     *
     * Stripe's ceiling is one year of span — 365 days, 52 weeks, 12 months,
     * 1 year — and `normalizeIntervalCount` is where that is enforced.
     */
    billingIntervalCount: integer("billing_interval_count").default(1).notNull(),
    /**
     * Days before the first charge. Null and zero both mean "charge now" —
     * and they mean the same thing on purpose, because a trial of zero days
     * is not a trial and Stripe rejects it as one.
     */
    trialDays: integer("trial_days"),

    /* ---- Membership depth — spec 49 -------------------------------------- */

    /**
     * How many cycles this membership runs for. NULL is open-ended, which is
     * every membership sold before this column.
     *
     * Two or more, never one: a one-cycle membership is a one-off purchase
     * wearing a subscription's clothes, and Stripe would create a recurring
     * price and cancel it immediately, leaving a subscription in the buyer's
     * portal for something that charged once. `normalizeCycles` refuses it.
     */
    termCycles: integer("term_cycles"),
    /**
     * Whether the door stays open once the term is paid off.
     *
     * This is what turns a fixed term into a **payment plan** — a course sold
     * in three instalments, expressed in a model that already works, and
     * without the instalments engine `GAP-2026-08-easytools.md` §4.7 refuses
     * on money-path grounds. Access is granted from the first payment either
     * way, so a failed third cycle costs the seller a payment rather than
     * leaving an entitlement half-earned.
     */
    accessAfterTerm: boolean("access_after_term").default(false).notNull(),
    /**
     * Cycles a member must pay before they may cancel. NULL is none.
     *
     * **On the manual rail this is not a lock and cannot be.** A member can
     * always stop paying, and no column here changes that. What a minimum term
     * governs is what the seller may *say* about it, and what a dispute is
     * argued from through the policy snapshot — the copy beside the field says
     * so rather than implying an obligation Sailo cannot enforce.
     */
    minimumTermCycles: integer("minimum_term_cycles"),
    /**
     * Days of notice before a period end. NULL is none.
     *
     * Never a refusal to cancel — it moves the date. A member who gives notice
     * a day late is cancelling the *next* period rather than being told they
     * may not leave, which is what a notice period means everywhere else it
     * exists.
     */
    cancelNoticeDays: integer("cancel_notice_days"),
    /**
     * The seller's own words, shown at checkout and again on the cancel
     * screen.
     *
     * **Disclosure at checkout is what makes a policy enforceable**, and it
     * feeds `cancellation_policy_disclosure` — a real Stripe evidence field
     * and the one that decides Visa 13.2. Snapshotted onto the order through
     * spec 44's `policy_snapshots`, so a dispute five months later cites the
     * terms the member actually saw.
     */
    cancelPolicyNote: text("cancel_policy_note"),
    /**
     * The most days a member may freeze for, over the life of their
     * membership. NULL is pausing not offered, which is every membership today.
     *
     * The ceiling is what stops a rolling permanent pause: freeze for
     * twenty-eight days, resume for one, freeze again — a free membership
     * assembled out of individually reasonable requests, which nobody notices
     * until the seller wonders why their busiest member never pays.
     */
    pauseMaxDays: integer("pause_max_days"),

    /**
     * The Stripe Price this product currently sells at, on the seller's own
     * connected account.
     *
     * Created lazily on the first subscribe and cached here, because a Price
     * is immutable in Stripe: a seller who changes what a membership costs
     * gets a *new* Price, and existing members keep the one they signed up
     * on until they resubscribe. That is the correct behaviour and it is also
     * the only behaviour Stripe offers.
     */
    stripePriceId: text("stripe_price_id"),
    /**
     * What `stripePriceId` was minted for.
     *
     * The staleness check, and it has to be a stored number rather than a
     * comparison against `priceCents` at read time: the Price object lives on
     * the seller's Stripe account where we cannot see it cheaply, and
     * charging last month's price because nobody noticed the edit is the
     * failure this column exists to make impossible.
     */
    stripePriceCents: integer("stripe_price_cents"),
    /**
     * And the interval it was minted on.
     *
     * The amount alone cannot answer "is this Price still right": a seller who
     * switches a £30 membership from monthly to yearly changes no number, so a
     * cents-only check sees nothing and keeps billing every month at a price
     * the product now says is annual. Cheap to store, and the alternative is a
     * comparison this module cannot make.
     */
    stripePriceInterval: text("stripe_price_interval"),
    /**
     * And how many of them.
     *
     * The same argument as `stripePriceInterval` one line up, for the same
     * reason it is a stored number: a membership moved from "every month" to
     * "every 3 months" changes neither the amount nor the interval, so a
     * check that compares only those two sees an unchanged product and goes
     * on billing monthly against a Price the seller no longer sells.
     */
    stripePriceIntervalCount: integer("stripe_price_interval_count"),

    inStock: boolean("in_stock").default(true).notNull(),
    isFeatured: boolean("is_featured").default(false).notNull(),
    isPublished: boolean("is_published").default(true).notNull(),
    position: integer("position").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("products_shop_slug_key").on(t.shopId, t.slug),
    index("products_shop_idx").on(t.shopId),
    // The `/api/v1` keyset. `products_shop_browse_idx` cannot serve it:
    // `is_featured` and `position` sit between `shop_id` and `created_at`.
    index("products_shop_keyset_idx").on(t.shopId, t.createdAt, t.id),
    index("products_category_idx").on(t.categoryId),
    // HQ's platform products list sorts newest-first across all shops; every
    // other index here is shop-prefixed, so that sort was a full-table sort.
    index("products_created_idx").on(t.createdAt),
    /**
     * The storefront's default order, batched. Without this a deep catalogue
     * sorts the whole published set on every batch, so the last batch costs
     * more than the first — which is the cost the batching exists to remove.
     */
    index("products_shop_browse_idx").on(
      t.shopId,
      t.isPublished,
      t.isFeatured,
      t.position,
      t.createdAt,
      t.id,
    ),
  ],
);

/**
 * One sellable combination of a product's options — the medium pizza, the red
 * shirt in large. Price, stock and SKU are per-variant; a blank price means
 * "same as the product", so a shirt that costs the same in every colour needs
 * no numbers typed at all.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /** One value per product option: { Size: "Large", Colour: "Red" }. */
    options: jsonb("options").$type<VariantOptions>().default({}).notNull(),

    sku: text("sku"),
    /** Null falls back to the product's price. */
    priceCents: integer("price_cents"),
    compareAtCents: integer("compare_at_cents"),

    /**
     * What this costs in the other currencies the shop quotes.
     *
     * `{ "EUR": { "price": 2500, "secondary": 3000 } }` — minor units in
     * *that* currency, decided by `currencyDecimals` and never by a flat 100.
     * `price` is the price charged; `secondary` is the compare-at price struck through beside it.
     *
     * Every number in here was typed by the seller. Nothing converts anything:
     * see `docs/specs/53-regional-pricing.md`. An absent currency is not a zero
     * and not a fallback — it is what makes that currency **not offered at
     * all**, which is the only safe answer when nobody has said what the price
     * should be.
     *
     * `{}` is the default and is what every existing row means.
     */
    currencyPrices: jsonb("currency_prices")
      .$type<CurrencyPrices>()
      .default({})
      .notNull(),
    /** Units left. Null while the product isn't tracking inventory. */
    stockQuantity: integer("stock_quantity"),
    /**
     * This combination's own weight and size — spec 51.
     *
     * Null falls back to the product's, the same rule its price already has: a
     * large weighs more than a small and that is most of what a size *is* on a
     * physical product, but a shirt that comes in three colours weighs the same
     * in all of them and its seller should not have to type it three times.
     */
    weightGrams: integer("weight_grams"),
    lengthMm: integer("length_mm"),
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),
    /**
     * This combination's own preorder promise and ceiling — spec 33.
     *
     * Null falls back to the product's, the same rule its price follows. The
     * blue medium may be six weeks out while the red small is two, and a buyer
     * shown the product's date for a combination that will take longer has been
     * told something untrue at the moment they were deciding.
     */
    preorderExpectedAt: timestamp("preorder_expected_at"),
    preorderLimit: integer("preorder_limit"),
    /** The seller's manual switch for this combination alone. */
    isAvailable: boolean("is_available").default(true).notNull(),
    /** Swapped into the gallery when this combination is picked. */
    imageUrl: text("image_url"),

    /**
     * This combination's own sell window — spec 43.
     *
     * **Narrows the product's window and can never widen it.** An early-bird
     * tier that closes on Friday inside a launch running all month is the case
     * these exist for; a tier claiming to open before its own product does
     * would sell something the seller has not put on sale yet. So the
     * effective start is the *later* of the two and the effective end the
     * *earlier* — `effectiveSellWindow` in `@sailo/core/pricing-models` is the
     * one place that decides it.
     */
    sellFrom: timestamp("sell_from"),
    sellUntil: timestamp("sell_until"),

    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("product_variants_product_idx").on(t.productId)],
);

/**
 * A file a digital product delivers. Buyers never see these URLs — the
 * download route streams the bytes behind a per-order token.
 */
export const productFiles = pgTable(
  "product_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /**
     * Which combination this file belongs to — spec 48.
     *
     * NULL is the product default, which is every file that existed before
     * this column. Delivery resolves to the ordered variant's files where any
     * exist and falls back to the default otherwise, which is Easytools' rule
     * and the one that leaves a single-variant catalogue untouched.
     *
     * **The download gate narrows with it.** Checking only that a file belongs
     * to the order's *product* would let the cheap variant download the
     * expensive one's files, which is this feature inverted.
     */
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    sizeBytes: integer("size_bytes"),
    contentType: text("content_type"),
    /**
     * The seller's own label — "v2", "2026 edition". Free text, because it is
     * shown to the buyer and never compared.
     */
    version: text("version"),
    /**
     * The file this one supersedes, when the seller uploaded a replacement
     * rather than overwriting.
     *
     * Deliberately not an entitlement: past buyers keep access to the
     * *current* file, which is what they expect and what already happened.
     * Versioning here is labelling plus an announcement, and there is no
     * per-order file pinning to go with it.
     */
    replacesFileId: uuid("replaces_file_id"),
    /**
     * The claim on "tell my buyers about this update", not a log of it.
     *
     * The send is a bulk mail wearing a product feature's clothes — it goes
     * through the broadcast quota and the suppression list — so it is claimed
     * by conditional UPDATE exactly as spec 33's waitlist notify is, and two
     * cron ticks send it once between them.
     */
    notifyBuyersAt: timestamp("notify_buyers_at"),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("product_files_product_idx").on(t.productId),
    index("product_files_variant_idx").on(t.productId, t.variantId),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: text("alt"),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    rating: integer("rating").notNull(), // 1..5
    body: text("body"),
    isApproved: boolean("is_approved").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("reviews_product_idx").on(t.productId),
    index("reviews_shop_idx").on(t.shopId),
  ],
);

/**
 * The rails a shop offers at checkout. Contact rails hand off to a chat app,
 * manual rails settle out of band, and card rails (later) redirect to a
 * gateway the seller owns. Config shape varies per type — see PaymentConfig.
 */

/**
 * One code out of a pool — spec 48.
 *
 * A pool is a pile of bearer tokens, and handing one out is spending
 * inventory. Which is why nothing in this table is ever written by a read
 * followed by a write: the claim is a conditional UPDATE whose subselect takes
 * `FOR UPDATE SKIP LOCKED`, so two concurrent releases take two different
 * codes rather than one blocking on the other, and never the same one twice.
 *
 * Claimed at *release*, not at checkout. The code is spent when
 * `orders.downloadReleasedAt` is set, exactly as the file and the event join
 * URL are — an abandoned card session must burn no key, and roughly a third
 * of them are abandoned.
 *
 * `revokedAt` is a refund, and a revoked code is **not** returned to the pool.
 * A key a buyer has already seen is spent whatever happens next; handing it to
 * a stranger is worse than losing the unit. The seller is told the count so
 * they can top up.
 */
export const productCodes = pgTable(
  "product_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /**
     * NULL is the product-level pool, which is every pool a seller starts
     * with. A per-variant pool is "PDF only" and "PDF + Figma" handing out
     * different keys.
     */
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),
    /**
     * The key, the serial, or — under `digitalDelivery: "link"` — the
     * one-seat invite URL. A URL goes through the same public-link guard at
     * the write that `digitalLinkUrl` does.
     */
    code: text("code").notNull(),
    claimedByOrderId: uuid("claimed_by_order_id"),
    claimedAt: timestamp("claimed_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * Per product and not globally. Two sellers can legitimately hand out the
     * same third-party string, and a global unique index would make one shop's
     * upload fail because of another's.
     */
    uniqueIndex("product_codes_product_code_key").on(t.productId, t.code),
    index("product_codes_unclaimed_idx").on(t.productId, t.variantId, t.createdAt),
    index("product_codes_order_idx").on(t.claimedByOrderId),
  ],
);

/**
 * A checkable licence — spec 48.
 *
 * A code pool serves anyone handing out a string; this serves the seller whose
 * *software* has to ask whether a string is still good. Lemon Squeezy's model,
 * because it is the one integrators already know: an activation limit, a
 * length, and one *instance* per machine.
 *
 * THE KEY IS STORED IN CLEAR, DELIBERATELY
 *
 * The buyer re-reads their own key from the delivery page and from an email
 * months later, so a value we cannot reproduce is a product that does not
 * work. Same call `doorPasses` and `tickets` already made, and for the same
 * reason. What a hashed store would have bought is bought another way:
 * `keyPrefix` is the indexed lookup and the only form ever logged, the full
 * key is compared in constant time after the row is found, and the public
 * endpoints answer an unknown key and a disabled one identically.
 */
export const licenseKeys = pgTable(
  "license_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Denormalised so a seller's licence list needs no join. */
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id"),
    clientId: uuid("client_id"),
    key: text("key").notNull(),
    /** The first group. Indexed for the lookup, and the only thing logged. */
    keyPrefix: text("key_prefix").notNull(),
    /** Machines at once. Null is unlimited, which sellers do mean. */
    activationLimit: integer("activation_limit"),
    /**
     * Seats currently taken — the *ceiling*, not the record.
     *
     * A counter row rather than a count of `license_activations`, and the
     * reason is what Postgres will and will not make atomic: under READ
     * COMMITTED a subquery counting activations cannot see rows other
     * transactions have not committed, so concurrent callers all pass a limit
     * that should stop all but the first few. `booking_slots` exists for
     * exactly the same reason on a different table.
     *
     * Moved only by a conditional UPDATE with the ceiling in the WHERE, which
     * Postgres re-evaluates against the latest committed row under its own
     * lock. `license_activations` stays the record of *which* machine and from
     * where, because that is what answers a dispute.
     */
    activationsUsed: integer("activations_used").default(0).notNull(),
    /**
     * Snapshotted from the product's licence length at mint time, so a seller
     * shortening the licence tomorrow does not shorten one already sold.
     */
    expiresAt: timestamp("expires_at"),
    status: text("status").default("active").notNull(), // active | disabled | expired
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("license_keys_key_key").on(t.key),
    index("license_keys_prefix_idx").on(t.keyPrefix),
    index("license_keys_order_idx").on(t.orderId),
    index("license_keys_shop_idx").on(t.shopId, t.createdAt),
  ],
);

/**
 * One machine a licence is running on.
 *
 * One row per (key, instance) for ever: a machine that deactivates and comes
 * back reuses its row rather than writing a second, so the live count is
 * `deactivatedAt IS NULL` and never a running total that only goes up.
 */
export const licenseActivations = pgTable(
  "license_activations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    licenseKeyId: uuid("license_key_id")
      .notNull()
      .references(() => licenseKeys.id, { onDelete: "cascade" }),
    instanceName: text("instance_name"),
    instanceIdentifier: text("instance_identifier").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    activatedAt: timestamp("activated_at").defaultNow().notNull(),
    deactivatedAt: timestamp("deactivated_at"),
  },
  (t) => [
    uniqueIndex("license_activations_instance_key").on(
      t.licenseKeyId,
      t.instanceIdentifier,
    ),
    index("license_activations_live_idx").on(t.licenseKeyId),
  ],
);

/**
 * One price band on one event — spec 50.
 *
 * `tickets.tier` existed as a column and nothing wrote a meaningful value,
 * because there was nothing to name: a product had one price and one stock
 * count, so "Early bird / General / VIP" was three products, three checkouts
 * and no shared capacity.
 *
 * WHY A TABLE AND NOT VARIANTS
 *
 * Variants exist and carry price, stock and SKU. But a variant is an *option
 * combination* driven by `products.options`, and forcing a tier into that
 * shape makes an event's tiers a fake option group — it renders in the option
 * picker and appears in every variant matrix. Tiers are their own list with
 * their own sale windows.
 *
 * CAPACITY IS TWO-LEVEL AND BOTH MUST HOLD
 *
 * A room of 200 with 30 VIP seats is a product stock of 200 and a tier
 * capacity of 30. A claim succeeds against **both** or fails, in one
 * transaction, **narrower first** — the tier, then the product. The other
 * order oversells the tier while the product still looks available, which is
 * the one failure an event seller cannot forgive.
 */
export const eventTiers = pgTable(
  "event_tiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").default(0).notNull(),
    /** NULL shares the product's stock — a single-tier event, which is today. */
    capacity: integer("capacity"),
    /**
     * The counter the claim moves, never a read followed by a write.
     *
     * `set sold = sold + n where capacity is null or sold + n <= capacity`, so
     * two concurrent checkouts for the last VIP seat produce one ticket. There
     * is a CHECK constraint under it as a floor — a seller editing a capacity
     * down below what has already sold must be refused by the database, not
     * only by the statement that happened to be looking.
     */
    sold: integer("sold").default(0).notNull(),
    /**
     * This tier's own window — spec 43's mechanism reused verbatim.
     *
     * Early bird expiring while General keeps selling is the case, and it is
     * why 43 put windows on variants too. Narrowed by the product's own window
     * through `effectiveSellWindow`, which is the one place that decides it.
     */
    sellFrom: timestamp("sell_from"),
    sellUntil: timestamp("sell_until"),
    maxPerOrder: integer("max_per_order"),
    position: integer("position").default(0).notNull(),
    /** A comp or press tier, reachable only by direct link. */
    isHidden: boolean("is_hidden").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("event_tiers_product_idx").on(t.productId, t.position)],
);

/**
 * One date an event actually runs on — spec 50.
 *
 * A weekly class, a three-day conference with day tickets, a workshop run four
 * times: each was a separate product, so the seller re-typed everything and
 * the attendee list was split.
 *
 * **No recurrence engine.** No RRULE, no infinite series. A "generate weekly
 * for 8 weeks" button that writes eight rows the seller can then edit
 * individually is the whole feature, and it never has to answer "what does
 * editing the series do to the one you have already sold tickets for".
 */
export const eventSessions = pgTable(
  "event_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at"),
    /** NULL shares the product's stock, as a tier's does. */
    capacity: integer("capacity"),
    sold: integer("sold").default(0).notNull(),
    location: text("location"),
    joinUrl: text("join_url"),
    isCancelled: boolean("is_cancelled").default(false).notNull(),
    /**
     * The claim on "tell the ticket-holders this session is off", not a log.
     *
     * A cancelled session's mail is a bulk send against the broadcast quota,
     * exactly as spec 33's waitlist notify is, so two cron ticks send it once
     * between them.
     */
    cancelNotifiedAt: timestamp("cancel_notified_at"),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("event_sessions_product_idx").on(t.productId, t.startsAt)],
);
