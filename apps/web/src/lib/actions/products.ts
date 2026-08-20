"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { revalidateShop } from "@/lib/cache";
import { publishShopEvent } from "@sailo/events";
import { firstRow } from "@sailo/core/invariant";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  optionalCents,
  optionalCount,
  readImageUrls,
  readJson,
  readJsonRows,
  readTags,
  text,
  shopMomentFrom,
  usableVariants,
  type FileRow,
  type SessionRow,
  type TierRow,
  type VariantRow,
} from "@/lib/products/form-fields";
import { categories, type CurrencyPrices, type ProductOption } from "@sailo/db/schema";
import { buildCurrencyPrices } from "@sailo/core/regional";
import { can } from "@sailo/core/plans";
import {
  deleteProduct as deleteProductRow,
  saveProduct as saveProductRow,
  toggleProductPublished as togglePublishedRow,
  type ProductInput,
  type SaveProductRefusal,
} from "@sailo/commerce/products";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { notifySellerOfLowStock } from "@sailo/workflows/orders";
import { notifyBackInStock } from "@sailo/workflows/catalog";
import { parseMoneyToCents } from "@sailo/core/currency";
import { slugify } from "@sailo/core/slug";
import { MAX_QUANTITY, isProductKind } from "@sailo/core/variants";
import type { ActionState } from "./shop";

/**
 * The product form, and nothing else.
 *
 * What is left here after `@sailo/commerce/products` took the write: reading a
 * `FormData`, saying no in English, and dropping the caches this app keeps.
 * The 245-line function these three used to share a body with was the most
 * entangled in the repo, and the reason it had to come apart is that a phone
 * posts JSON to `products.save` and needs every rule in the middle of it —
 * the category check, the membership refusals, the file-URL guard, the product
 * limit — without needing any of the three things above.
 *
 * The division is by what the input is. Anything that reads `formData` is
 * here; anything that would be equally true of a product posted as JSON is
 * there. `saveProduct` below should stay boring: if a rule ever needs adding,
 * it almost certainly belongs on the other side of this file.
 */

/** The seller's own words for each refusal the domain can return. */
function sentenceFor(refusal: SaveProductRefusal): string {
  switch (refusal.kind) {
    case "no_title":
      return "Product needs a title.";
    case "unknown_category":
      return "That category doesn't exist.";
    case "event_needs_start":
      return "An event needs a date and time.";
    case "event_ends_before_start":
      return "The event's end has to come after it starts.";
    case "digital_needs_delivery":
      return refusal.delivery === "link"
        ? "Add the link buyers get after paying."
        : "Add the code or joining details buyers get after paying.";
    case "digital_link_not_public":
      return "The download link must be a public https:// address.";
    /*
     * Three different problems behind one refusal, and a seller cannot guess
     * which they hit — so each gets its own sentence. The third is the one
     * worth wording carefully: a pattern that folds to the length of a ticket
     * or a member pass would put a third string into a space the door resolves
     * by arithmetic, and "make it longer or shorter" is the only instruction
     * that actually fixes it.
     */
    case "code_pattern_invalid":
      return refusal.reason === "not_enough_random"
        ? "A code pattern needs at least ten X's — each one becomes a random character."
        : refusal.reason === "collides_with_scan_codes"
          ? "That pattern is the same length as a ticket or a member pass. Add or remove a character."
          : "That code pattern can't be used. Try something like SAILO-XXXX-XXXX-XXXX.";
    case "membership_needs_interval":
      return "Choose how often a membership is charged.";
    case "membership_needs_price":
      return "A membership needs a price to charge.";
    case "join_url_not_public":
      return "The join link must be a public https:// address.";
    case "event_time_zone_unknown":
      return "We don't recognise that time zone. Pick one from the list.";
    case "event_needs_venue":
      return "An in-person event needs an address before you publish it.";
    case "event_needs_join_url":
      return "An online event needs a join link before you publish it.";
    /*
     * Named and counted, because the number is the whole instruction: a seller
     * looking at eight bands cannot act on "a capacity is too low", and the
     * database's own refusal is an exception with a constraint name in it.
     */
    case "capacity_below_sold":
      return refusal.level === "tier"
        ? `You've already sold ${refusal.sold} of ${refusal.name}. A tier can't hold fewer seats than it has sold.`
        : `You've already sold ${refusal.sold} tickets for ${refusal.name}. A date can't hold fewer seats than it has sold.`;
    case "sell_window_inverted":
      return "Sales have to close after they open. Check the two dates.";
    case "pwyw_not_for_membership":
      return "A membership needs a fixed price — buyers can't name their own for a recurring charge.";
    case "product_limit":
      return `You've reached the ${refusal.limit}-product limit on ${refusal.planName}. Upgrade to add more.`;
    case "not_found":
      return "Product not found.";
  }
}

/**
 * A `datetime-local` value, read as an instant in the server's clock.
 *
 * The form labels it with the shop's time zone, and a seller placing a 7pm show
 * wants "7pm where the event is", which for a link-in-bio seller is
 * overwhelmingly their own zone.
 *
 * Takes the field name because the event now has two of them, and a second
 * copy of this that parsed the end time slightly differently is exactly the
 * kind of drift that makes an end land before its own start.
 */
function readMoment(formData: FormData, name: string): Date | null {
  return momentFrom(formData.get(name));
}

/**
 * The same, out of a value rather than out of the bag.
 *
 * Two entry points and one parser, for the reason `readShopMoment` states
 * below: an event's start arrives as a `FormData` field and each of its
 * sessions' arrives as a string inside that row's JSON blob, and two parsers
 * that differed by an hour would put a class an hour away from the event it
 * belongs to.
 */
function momentFrom(value: FormDataEntryValue | string | undefined | null): Date | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * A `datetime-local` value, read as wall-clock time in the shop's own zone.
 *
 * Different from `readMoment` above on purpose, and the difference is the one
 * spec 43 names. An event's start is a moment the seller thinks of in the
 * zone of the venue, which for a link-in-bio seller is their own — reading it
 * against the server's clock has been close enough because the server's clock
 * is UTC and the field is labelled with the zone.
 *
 * A sell window is not that. "Sales close on the 31st" means the 31st where the
 * seller is, and the whole point of the feature is that a boundary lands when
 * they said it would — including across a DST change, where the offset on the
 * day the window opens differs from the offset today. `zonedTimeToInstant`
 * resolves the wall clock against the zone's rules at that instant and answers
 * null for a time that does not exist (the hour a spring-forward skips), which
 * is exactly the case a naive `new Date(raw)` silently moves by an hour.
 *
 * So the DST question is answered once, here, at the write — and every read
 * downstream is an instant comparison that cannot get it wrong.
 */
/**
 * The same, read out of the form bag.
 *
 * Two entry points and one parser, because the product's own window arrives as
 * a `FormData` field and each variant's arrives as a string inside that row's
 * JSON blob. Two parsers that differed by an hour would be the drift
 * `readMoment`'s own note warns about, on the pair where it decides whether a
 * tier is on sale at all.
 */
function readShopMoment(
  formData: FormData,
  name: string,
  timeZone: string,
): Date | null {
  return shopMomentFrom(formData.get(name), timeZone);
}

/** The form, as the domain understands it. Every string is already a value. */
/**
 * The per-currency price fields the product form posts — spec 53.
 *
 * One pair per currency, named `price_EUR` / `compareAtPrice_EUR`, parsed
 * against **that currency's** decimals. `prefix` exists so the same reader
 * serves the product's own fields and, later, anything else that needs the
 * same pair set.
 *
 * `buildCurrencyPrices` is what actually decides what is stored: it refuses a
 * currency outside the offered set, and it drops a blank rather than storing a
 * zero. Blank ≠ zero, on the field where confusing them prices a catalogue at
 * nothing.
 */
function readCurrencyPrices(
  formData: FormData,
  currencies: readonly string[],
  prefix: string,
): CurrencyPrices {
  return buildCurrencyPrices(
    currencies.map((code) => ({
      currency: code,
      priceCents: optionalCents(formData.get(`${prefix}price_${code}`), code),
      secondaryCents: optionalCents(
        formData.get(`${prefix}compareAtPrice_${code}`),
        code,
      ),
    })),
  );
}

/** A variant row's own per-currency price, as the editor serialises it. */
function readVariantPrice(row: VariantRow, code: string): unknown {
  const prices = (row as Record<string, unknown>)[`price_${code}`];
  return prices ?? null;
}

function readVariantCompareAt(row: VariantRow, code: string): unknown {
  return (row as Record<string, unknown>)[`compareAt_${code}`] ?? null;
}

function readProduct(
  formData: FormData,
  currency: string,
  timeZone: string,
  /** The other currencies the shop quotes. Empty means one currency. */
  regionalCurrencies: readonly string[],
): ProductInput {
  const kindRaw = String(formData.get("kind") ?? "physical");
  const kind = isProductKind(kindRaw) ? kindRaw : "physical";

  const options = readJson<ProductOption[]>(formData.get("options")) ?? [];
  const variantRows = readJsonRows<VariantRow>(formData, "variants");

  return {
    id: String(formData.get("id") ?? "").trim() || null,
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    priceCents: parseMoneyToCents(String(formData.get("price") ?? "0"), currency),
    compareAtCents: optionalCents(formData.get("compareAtPrice"), currency),
    /*
     * The same price in each currency the shop quotes — spec 53.
     *
     * Read against the *target* currency's decimals rather than the shop's, so
     * a seller typing 2500 into a HUF field means Ft 2,500 and not Ft 25. That
     * is the same asymmetry `moneyToCents` exists to prevent, arriving one
     * level up: the shop's currency decides nothing about a price denominated
     * in another one.
     *
     * Blank drops the currency rather than storing a zero — `buildCurrencyPrices`
     * enforces that, and it is what keeps "no price yet" and "free" apart on
     * the field where confusing them gives a catalogue away.
     */
    currencyPrices: readCurrencyPrices(formData, regionalCurrencies, ""),

    /*
     * Spec 43. Blank stays blank on both money fields, which is the whole rule:
     * `optionalCents` answers null for an empty box and a number for "0", so
     * "not configured" and "free is allowed" reach the domain as the two
     * different things they are.
     */
    pricingMode: String(formData.get("pricingMode") ?? "fixed"),
    minPriceCents: optionalCents(formData.get("minPrice"), currency),
    suggestedPriceCents: optionalCents(formData.get("suggestedPrice"), currency),
    sellFrom: readShopMoment(formData, "sellFrom", timeZone),
    sellUntil: readShopMoment(formData, "sellUntil", timeZone),
    hideWhenUnavailable: formData.get("hideWhenUnavailable") === "on",

    kind,
    categoryId: String(formData.get("categoryId") ?? ""),
    tags: readTags(formData),
    sku: text(formData.get("sku"), 60),
    maxPerOrder: optionalCount(formData.get("maxPerOrder"), MAX_QUANTITY),
    options,

    /*
     * Filtered here as well as in the package, and the two are not the same
     * filter. This one drops rows the *form* cannot mean — a combination left
     * behind by an option rename, posted as strings by a browser — before any
     * of them become numbers. The package applies the same rule from the same
     * source, `@sailo/core/variants`, to whatever any caller hands it.
     */
    variants: usableVariants(options, variantRows).map((row) => ({
      options: row.options,
      sku: text(row.sku, 60),
      // Blank is "same as the product", which is not the same as free.
      priceCents: optionalCents(row.price, currency),
      compareAtCents: optionalCents(row.compareAt, currency),
      /*
       * The combination's own per-currency prices — spec 53. Carried on the
       * variant row's JSON blob the way its other money already is, keyed by
       * currency code, and only meaningful when the variant overrides the
       * product's price at all.
       */
      currencyPrices: buildCurrencyPrices(
        regionalCurrencies.map((code) => ({
          currency: code,
          priceCents: optionalCents(readVariantPrice(row, code), code),
          secondaryCents: optionalCents(readVariantCompareAt(row, code), code),
        })),
      ),
      // Blank is "nobody is counting", which is not the same as sold out.
      stockQuantity: optionalCount(row.stock),
      isAvailable: row.available !== false,
      imageUrl: typeof row.image === "string" ? row.image : null,
      /*
       * This combination's own window — an early-bird tier that closes while
       * the product keeps selling. Read from the row's JSON in the shop's zone,
       * the same way the product's own two are.
       */
      sellFrom: shopMomentFrom(row.sellFrom, timeZone),
      sellUntil: shopMomentFrom(row.sellUntil, timeZone),
    })),

    files: readJsonRows<FileRow>(formData, "files").flatMap((f) =>
      typeof f.url === "string" ? [{ ...f, url: f.url }] : [],
    ),
    imageUrls: readImageUrls(formData),

    trackInventory: formData.get("trackInventory") === "on",
    stockQuantity: optionalCount(formData.get("stockQuantity")),

    /*
     * Spec 51. Blank stays blank on all five: an unweighed product weighs
     * nothing as far as a band table is concerned, and a product with no
     * threshold gets no alert. Neither is the same as zero, and `optionalCount`
     * is what keeps them apart.
     *
     * Capped at a tonne and at ten metres — not to be clever about parcels, but
     * because these are integers a browser posts and something has to bound
     * them before they reach an `integer` column.
     */
    lowStockThreshold: optionalCount(formData.get("lowStockThreshold"), 1_000_000),

    /*
     * Spec 33. The date is a wall-clock moment in the shop's own zone, read
     * through the same parser the sell window uses — a seller writing "the 3rd"
     * means the 3rd where they are, and one parser means a product's window and
     * its preorder date cannot land an hour apart.
     */
    preorderEnabled: formData.get("preorderEnabled") === "on",
    preorderExpectedAt: readShopMoment(formData, "preorderExpectedAt", timeZone),
    preorderLimit: optionalCount(formData.get("preorderLimit"), 1_000_000),
    weightGrams: optionalCount(formData.get("weightGrams"), 1_000_000),
    lengthMm: optionalCount(formData.get("lengthMm"), 10_000),
    widthMm: optionalCount(formData.get("widthMm"), 10_000),
    heightMm: optionalCount(formData.get("heightMm"), 10_000),

    digitalDelivery: String(formData.get("digitalDelivery") ?? "file"),
    digitalLinkUrl: String(formData.get("digitalLinkUrl") ?? ""),
    digitalAccessDetails: text(formData.get("digitalAccessDetails"), 2000),
    /*
     * Spec 48. Blank is the shared string — today's behaviour — so an empty
     * select must reach the domain as null rather than as a third state the
     * `isCodeSource` guard would have to invent a meaning for.
     */
    codeSource: text(formData.get("codeSource"), 20),
    codePattern: text(formData.get("codePattern"), 64),
    licenseEnabled: formData.get("licenseEnabled") === "on",
    licenseActivationLimit: optionalCount(formData.get("licenseActivationLimit"), 10_000),
    licenseDays: optionalCount(formData.get("licenseDays"), 3650),
    releaseOnPayment: formData.get("releaseOnPayment") === "on",
    downloadLimit: optionalCount(formData.get("downloadLimit"), 1000),
    downloadExpiryDays: optionalCount(formData.get("downloadExpiryDays"), 3650),

    durationMinutes: optionalCount(formData.get("durationMinutes"), 60 * 24 * 30),
    serviceMode: String(formData.get("serviceMode") ?? "in_person"),
    serviceLocation: text(formData.get("serviceLocation"), 500),
    bookingEnabled: formData.get("bookingEnabled") === "on",
    bookingLeadHours: optionalCount(formData.get("bookingLeadHours"), 24 * 365) ?? 0,
    bookingBufferMinutes: optionalCount(formData.get("bookingBufferMinutes"), 24 * 60),

    /* ---- Spec 49 ------------------------------------------------------ */
    termCycles: optionalCount(formData.get("termCycles"), 520),
    accessAfterTerm: formData.get("accessAfterTerm") === "on",
    minimumTermCycles: optionalCount(formData.get("minimumTermCycles"), 520),
    cancelNoticeDays: optionalCount(formData.get("cancelNoticeDays"), 365),
    cancelPolicyNote: text(formData.get("cancelPolicyNote"), 2000),
    pauseMaxDays: optionalCount(formData.get("pauseMaxDays"), 365),

    /* ---- Spec 50 ------------------------------------------------------- */
    sessionMode: text(formData.get("sessionMode"), 20),
    collectAttendeeDetails: formData.get("collectAttendeeDetails") === "on",
    eventMode: text(formData.get("eventMode"), 20),
    eventVenueName: text(formData.get("eventVenueName"), 200),
    eventAddress: text(formData.get("eventAddress"), 500),
    eventTimeZone: text(formData.get("eventTimeZone"), 64),
    eventRefundPolicy: text(formData.get("eventRefundPolicy"), 2000),
    eventRefundCutoffHours: optionalCount(formData.get("eventRefundCutoffHours"), 8760),
    eventAllowSelfCancel: formData.get("eventAllowSelfCancel") === "on",

    /*
     * The event's price bands and its dates — spec 50.
     *
     * One JSON blob per row, exactly as the variant and file editors post
     * theirs and for the same reason: a browser omits an unchecked checkbox
     * entirely, so parallel `name[]` / `hidden[]` arrays would shift every
     * later row's "hidden" onto the wrong band the moment one was unticked.
     *
     * Always an array and never undefined, which is the signal `saveProduct`
     * reads: this form renders the editors whenever the product is an event on
     * a plan that has them, so an empty list here means the seller removed the
     * last row. A caller that never sees the list — the phone — sends nothing
     * at all and leaves the rows alone.
     */
    tiers: readJsonRows<TierRow>(formData, "tiers").map((row) => ({
      // Blank creates; an id belonging to another product cannot match, so it
      // creates too. `saveProduct` decides that from this product's own rows.
      id: text(row.id, 40),
      name: String(row.name ?? ""),
      /* Blank is free, not "inherit". A comp or press band costs nothing and
         `event_tiers.price_cents` is NOT NULL, so there is no third state. */
      priceCents: optionalCents(row.price, currency) ?? 0,
      // Blank shares the room's capacity — the hint under the field says so.
      capacity: optionalCount(row.capacity, 1_000_000),
      isHidden: row.hidden === true,
    })),
    sessions: readJsonRows<SessionRow>(formData, "sessions").flatMap((row) => {
      /* Read against the server's clock, like the event's own start and
         deliberately not like a sell window: the form labels both with the
         shop's zone, and one parser is what keeps a session from landing an
         hour away from the event it belongs to. */
      const startsAt = momentFrom(row.startsAt);
      if (!startsAt) return [];
      return [
        {
          id: text(row.id, 40),
          startsAt,
          endsAt: momentFrom(row.endsAt),
          capacity: optionalCount(row.capacity, 1_000_000),
          isCancelled: row.cancelled === true,
        },
      ];
    }),

    /* ---- Spec 51 ------------------------------------------------------- */
    /*
     * Who takes bookings for this service — `product_staff`.
     *
     * `has` and not `getAll`, and the difference is the whole rule. A checkbox
     * group posts nothing when none of it is checked, so an absent field and a
     * cleared list look identical — the card posts a hidden marker so they stop
     * looking identical, and this reads the marker. `undefined` leaves the
     * assignment alone, which is what a form with no roster on it means and
     * what the phone means; `[]` is a seller who unticked everybody, which
     * means *anybody* may take it.
     */
    staffIds: formData.has("staffIds")
      ? formData.getAll("staffIds").map(String).filter(Boolean)
      : undefined,
    bookingCapacity: optionalCount(formData.get("bookingCapacity"), 500),
    rescheduleCutoffHours: optionalCount(formData.get("rescheduleCutoffHours"), 8760),
    cancelCutoffHours: optionalCount(formData.get("cancelCutoffHours"), 8760),

    eventStartsAt: readMoment(formData, "eventStartsAt"),
    eventEndsAt: readMoment(formData, "eventEndsAt"),
    eventJoinUrl: String(formData.get("eventJoinUrl") ?? ""),

    /*
     * The enquiry form's questions, as one JSON field — spec 07.
     *
     * One field rather than parallel `label[]` / `required[]` arrays, because
     * the browser omits an unchecked checkbox entirely: delete a middle row and
     * the flags shift up by one, so every question after it silently changes
     * whether it is required. Parsed defensively — a body is a body, and
     * `normalizeQuestions` re-derives every id server-side regardless.
     */
    leadQuestions: readLeadQuestions(formData.get("leadQuestions")),

    billingInterval: String(formData.get("billingInterval") ?? ""),
    billingIntervalCount: optionalCount(formData.get("billingIntervalCount"), 365),
    trialDays: optionalCount(formData.get("trialDays")),

    inStock: formData.get("inStock") === "on",
    isFeatured: formData.get("isFeatured") === "on",
    isPublished: formData.get("isPublished") === "on",
  };
}

/**
 * Drops everything this app caches about a shop's catalogue.
 *
 * Handed to nothing — called after the write rather than passed into it —
 * because unlike `changeOrderStatus`'s seam there is no shared orchestration
 * here to hand it to. Both writers below need the same four, so it is one
 * function rather than four lines copied twice.
 */
function dropCatalogueCaches(shop: { id: string; handle: string }, slug?: string) {
  revalidatePath("/admin/products");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
  after(() => publishShopEvent(shop.id, "catalog"));
  // Variant prices and stock live on the detail page too.
  if (slug) revalidatePath(`/${shop.handle}/p/${slug}`);
}

export async function saveProduct(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("products:write");

  /*
   * The currencies whose fields this form may have posted — spec 53.
   *
   * Taken from the shop row and gated on the plan, never from the request: the
   * field names are `price_EUR`, so a hand-rolled POST could otherwise write a
   * price in a currency this shop does not offer, and a currency with a price
   * on every product is one `liveCurrencies` will happily put on a storefront.
   */
  const regionalCurrencies = can(shop, "regionalPricing")
    ? shop.regionalCurrencies
    : [];

  const result = await saveProductRow(
    shop,
    readProduct(formData, shop.currency, shop.timeZone, regionalCurrencies),
  );
  if (!result.ok) return { ok: false, error: sentenceFor(result.refusal) };

  dropCatalogueCaches(shop, result.slug);

  /*
   * A seller typing a new stock count crosses the line as surely as an order
   * does — spec 51.
   *
   * This is the path that *re-arms* the alert as well as the one that fires it,
   * and the re-arm is the half that matters most here: a restock happens on
   * this screen and nowhere else, so without this call a shop would hear once
   * about a shortage and then never again for the life of the product.
   *
   * After the caches are dropped and inside `after()`, because it reports on a
   * save that has already succeeded.
   */
  after(() => notifySellerOfLowStock({ shop, productId: result.id }));

  /*
   * And whoever asked to be told when it came back — spec 33.
   *
   * This save is the trigger, because raising the count is the one thing a
   * seller does that makes stock cross zero upward. There is no poll: a queue
   * checked on a schedule tells somebody four hours after the thing sold out
   * again.
   *
   * Called unconditionally rather than only when the count went up.
   * `notifyBackInStock` re-asks `isSellable` itself, which is the same
   * predicate the storefront and the checkout use — so a save that *lowered*
   * stock sends nothing, and the decision is not made twice from two different
   * readings of the same row.
   */
  after(() => notifyBackInStock({ shop, productId: result.id }));

  /*
   * The one message on this form that is not English.
   *
   * Every refusal above is a hardcoded sentence — that is this file's standing
   * convention and it is recorded debt, not an oversight. These two are
   * different only because the keys already exist, translated into all 35
   * languages, and were sitting unread: a German seller was told "Product
   * updated." by a screen that was German everywhere else. Reading them costs
   * one cookie lookup on a path that has already written to the database.
   */
  const { a } = await getAdminT();
  return {
    ok: true,
    message: result.created ? a.productForm.added : a.productForm.updated,
  };
}

export async function deleteProduct(formData: FormData) {
  const { shop } = await requireShop("products:write");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await deleteProductRow(shop.id, id);
  dropCatalogueCaches(shop);
}

export async function toggleProductPublished(formData: FormData) {
  const { shop } = await requireShop("products:write");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await togglePublishedRow(shop.id, id);
  dropCatalogueCaches(shop);
}

/* -------------------------------------------------------------------------- */
/*  Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function createCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("products:write");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Category needs a name." };

  const slug = slugify(name);
  const db = getDb();

  const exists = await db.query.categories.findFirst({
    where: and(eq(categories.shopId, shop.id), eq(categories.slug, slug)),
    columns: { id: true },
  });
  if (exists) return { ok: false, error: "You already have that category." };

  const { max } = firstRow(await db
    .select({ max: sql<string>`coalesce(max(${categories.position}), 0)` })
    .from(categories)
    .where(eq(categories.shopId, shop.id)), "max aggregate");

  await db
    .insert(categories)
    .values({ shopId: shop.id, name, slug, position: Number(max) + 1 });

  revalidatePath("/admin/categories");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
  after(() => publishShopEvent(shop.id, "catalog"));
  return { ok: true, message: "Category added." };
}

export async function deleteCategory(formData: FormData) {
  const { shop } = await requireShop("products:write");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.shopId, shop.id)));

  revalidatePath("/admin/categories");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
  after(() => publishShopEvent(shop.id, "catalog"));
}

/** `[{ label, required }]` out of the hidden field the lead card posts. */
function readLeadQuestions(
  raw: FormDataEntryValue | null,
): { label: string; required: boolean }[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const value = row as Record<string, unknown>;
      const label = typeof value.label === "string" ? value.label : "";
      return label.trim() ? [{ label, required: value.required === true }] : [];
    });
  } catch {
    // A body that is not JSON is a client that is not ours. No questions is
    // the safe reading — it saves a form that asks nothing rather than
    // refusing a save over a field the seller never sees.
    return [];
  }
}
