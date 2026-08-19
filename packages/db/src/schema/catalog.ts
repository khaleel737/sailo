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
    index("products_category_idx").on(t.categoryId),
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

    name: text("name").notNull(),
    url: text("url").notNull(),
    sizeBytes: integer("size_bytes"),
    contentType: text("content_type"),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("product_files_product_idx").on(t.productId)],
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
