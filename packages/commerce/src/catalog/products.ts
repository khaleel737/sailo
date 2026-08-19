/**
 * Saving, deleting and publishing a product.
 *
 * The write path. Its validation helpers stay beside it rather than moving with the types:
 * `usable` decides what the *table* is allowed to hold — a stale row left by an option rename is
 * an orphan no buyer can select — which is a fact about the write, not about the input.
 *
 * `@sailo/commerce/catalog` re-exports this folder, so no caller moved.
 */

import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { normalizeQuestions } from "@sailo/core/lead-questions";
import {
  categories,
  productFiles,
  productImages,
  productVariants,
  products,
  type CurrencyPrices,
  type ProductOption,
  type Shop,
} from "@sailo/db/schema";
import { atProductLimit, can, planFor, productLimit } from "@sailo/core/plans";
import { normalizePricingMode } from "@sailo/core/pricing-models";
import { isPublicLinkUrl, isRenderableImageUrl, isStoredFileUrl } from "@sailo/storage/urls";
import { DEFAULT_CODE_PATTERN, checkCodePattern } from "@sailo/core/codes";
import { isCodeSource } from "./code-pool";
import {
  isBillingInterval,
  normalizeIntervalCount,
  normalizeTrialDays,
} from "@sailo/commerce/memberships";
import { slugify } from "@sailo/core/slug";
import {
  MAX_QUANTITY,
  MAX_VARIANTS,
  combinations,
  isDigitalDelivery,
  isProductKind,
  isServiceMode,
  normalizeOptions,
  optionKey,
} from "@sailo/core/variants";
import {
  MAX_FILES,
  MAX_IMAGES,
  MAX_TAGS,
  type ProductFileInput,
  type ProductInput,
  type ProductVariantInput,
  type SaveProductRefusal,
  type SaveProductResult,
} from "./product-input";


/**
 * A per-currency price map with every unhelpful strike-through removed.
 *
 * The rule the shop's own price already has, applied in each currency: a
 * compare-at at or below the price is not a saving, it is an advertisement for
 * a discount nobody is giving. Checked per currency and not across them,
 * because €30 and $25 are not comparable numbers and nothing here converts.
 */
function droppingWeakCompareAt(prices: CurrencyPrices): CurrencyPrices {
  const out: CurrencyPrices = {};
  for (const [code, entry] of Object.entries(prices)) {
    const secondary = entry.secondary ?? null;
    out[code] = {
      price: entry.price,
      secondary: secondary !== null && secondary <= entry.price ? null : secondary,
    };
  }
  return out;
}

export * from "./product-input";

/** Appends -2, -3 … until the slug is free within the shop. */
async function uniqueSlug(shopId: string, base: string, exceptId?: string) {
  const db = getDb();
  let slug = base;
  let n = 1;
  for (;;) {
    const clash = await db.query.products.findFirst({
      where: and(eq(products.shopId, shopId), eq(products.slug, slug)),
      columns: { id: true },
    });
    if (!clash || clash.id === exceptId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

/**
 * Only combinations the product's options actually describe, one row each.
 *
 * The same rule `lib/products/form-fields.ts` applies to the form's own rows,
 * reached the same way — `combinations` and `optionKey` from
 * `@sailo/core/variants` decide it, and neither restates it. That one runs over
 * strings a browser posted and is part of reading the form; this one runs over
 * whatever any caller handed us and is part of what the table is allowed to
 * hold. A stale row left by an option rename is an orphan no buyer can select.
 */
function usable(options: ProductOption[], rows: ProductVariantInput[]) {
  if (options.length === 0) return [];

  const allowed = new Set(combinations(options).map(optionKey));
  const seen = new Set<string>();
  const kept: ProductVariantInput[] = [];

  for (const row of rows) {
    if (!row.options || typeof row.options !== "object") continue;
    const key = optionKey(row.options);
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
    if (kept.length >= MAX_VARIANTS) break;
  }

  return kept;
}

/**
 * Variants are matched on their combination rather than replaced wholesale:
 * past orders point at a variant row, and dropping it would blank the link
 * every time the seller saves an unrelated edit.
 */
async function syncVariants(
  productId: string,
  options: ProductOption[],
  rows: ProductVariantInput[],
  trackInventory: boolean,
) {
  const db = getDb();
  const wanted = usable(options, rows);

  const existing = await db.query.productVariants.findMany({
    where: eq(productVariants.productId, productId),
  });
  const byKey = new Map(existing.map((v) => [optionKey(v.options), v]));

  for (const [position, row] of wanted.entries()) {
    const priceCents = row.priceCents ?? null;
    const values = {
      options: row.options,
      sku: trimmed(row.sku, 60),
      priceCents,
      // A strike-through only means something next to its own price.
      compareAtCents: (() => {
        const compare = row.compareAtCents ?? null;
        return compare !== null && priceCents !== null && compare <= priceCents
          ? null
          : compare;
      })(),
      currencyPrices: droppingWeakCompareAt(row.currencyPrices ?? {}),
      stockQuantity: trackInventory ? (row.stockQuantity ?? null) : null,
      isAvailable: row.isAvailable !== false,
      /*
       * This combination's own window — spec 43. Stored as given and never
       * clamped to the product's: `effectiveSellWindow` narrows at every read,
       * so a seller who widens the product's launch later gets the tier window
       * they actually typed back rather than one silently truncated on save.
       */
      sellFrom: row.sellFrom ?? null,
      sellUntil: row.sellUntil ?? null,
      /* Spec 33 — the blue medium may be six weeks out while the red small is
         two, and a buyer shown the product's date for the slower one has been
         told something untrue at the moment they were deciding. */
      preorderExpectedAt: row.preorderExpectedAt ?? null,
      preorderLimit: wholeCountOrNull(row.preorderLimit),
      /* Spec 51 — null falls back to the product's, the same rule its price
         already follows. */
      weightGrams: wholeCountOrNull(row.weightGrams),
      lengthMm: wholeCountOrNull(row.lengthMm),
      widthMm: wholeCountOrNull(row.widthMm),
      heightMm: wholeCountOrNull(row.heightMm),
      // Fetched server-side by the social card, so it gets the same host
      // check the product's own gallery does.
      imageUrl: isRenderableImageUrl(row.imageUrl) ? row.imageUrl : null,
      position,
      updatedAt: new Date(),
    };

    const match = byKey.get(optionKey(row.options));
    if (match) {
      await db
        .update(productVariants)
        .set(values)
        .where(eq(productVariants.id, match.id));
      byKey.delete(optionKey(row.options));
    } else {
      await db.insert(productVariants).values({ ...values, productId });
    }
  }

  const stale = [...byKey.values()].map((v) => v.id);
  if (stale.length) {
    await db.delete(productVariants).where(inArray(productVariants.id, stale));
  }
}

async function syncFiles(productId: string, rows: ProductFileInput[]) {
  const db = getDb();
  /*
   * The host, not just the scheme.
   *
   * `flatMap` rather than `filter` because `filter` narrows nothing: a later
   * `f.url` would have to be asserted despite the line above having proved it.
   *
   * This checked `^https?://` and nothing else, which is no check at all: the
   * upload widget in front of a write is not a gate. Any URL stored here is
   * later fetched *server-side* by `/api/download/[token]/[fileId]`, whose
   * response is streamed back to the caller — so a seller, and signup is open,
   * could point a file at a cloud metadata endpoint or anything else the
   * function can reach, buy their own product, and read the reply.
   */
  const kept = rows
    .flatMap((f) => (isStoredFileUrl(f.url) ? [{ ...f, url: f.url }] : []))
    .slice(0, MAX_FILES);

  /*
   * MATCHED ON URL RATHER THAN DELETED AND RE-INSERTED — spec 48
   *
   * This used to clear the table and write it again, which minted a new `id`
   * for every file on every save. Two things now depend on that id being
   * stable: `notify_buyers_at` is a *claim* on one file's update announcement,
   * and it would be reset by a seller renaming an unrelated file; and the
   * buyer's own `/download/[token]/[fileId]` link would 404 after any edit to
   * the product, which was already a real bug and simply had nobody to notice
   * it.
   *
   * A file *is* its URL here — the uploader mints an immutable storage key per
   * upload — so matching on it identifies the same file across a save, and
   * anything the seller replaced arrives as a different URL and is written as
   * a new row.
   */
  const existing = await db.query.productFiles.findMany({
    where: eq(productFiles.productId, productId),
  });
  const byUrl = new Map(existing.map((f) => [f.url, f]));

  const variantIds = await variantIdsByKey(productId);

  let position = 0;
  for (const f of kept) {
    const values = {
      name: trimmed(f.name, 200) ?? "Download",
      sizeBytes:
        typeof f.sizeBytes === "number" && Number.isFinite(f.sizeBytes)
          ? Math.max(0, Math.trunc(f.sizeBytes))
          : null,
      contentType: trimmed(f.contentType, 120),
      /*
       * Resolved from the option combination rather than taken as an id.
       * `syncVariants` runs before this and may have just created the row the
       * seller is assigning to, so an id posted by the browser would name a
       * variant that no longer exists — the same reason the order line
       * snapshots a variant's options rather than joining to it.
       */
      variantId: f.variantOptions
        ? (variantIds.get(optionKey(f.variantOptions)) ?? null)
        : null,
      version: trimmed(f.version, 60),
      position: position++,
      updatedAt: new Date(),
    };

    const match = byUrl.get(f.url);
    if (match) {
      await db.update(productFiles).set(values).where(eq(productFiles.id, match.id));
      byUrl.delete(f.url);
    } else {
      await db.insert(productFiles).values({ ...values, productId, url: f.url });
    }
  }

  const stale = [...byUrl.values()].map((f) => f.id);
  if (stale.length) {
    await db.delete(productFiles).where(inArray(productFiles.id, stale));
  }
}

/** The variant rows this product actually has, keyed by their option string. */
async function variantIdsByKey(productId: string): Promise<Map<string, string>> {
  const rows = await getDb().query.productVariants.findMany({
    where: eq(productVariants.productId, productId),
    columns: { id: true, options: true },
  });
  return new Map(rows.map((v) => [optionKey(v.options), v.id]));
}

/**
 * A whole number of minor units, or null — spec 43.
 *
 * Null survives as null, which is what makes "not configured" distinguishable
 * from "zero" on `minPriceCents`. Fractions are truncated because a minor unit
 * is the smallest thing money comes in, and negatives become zero rather than
 * being refused: a negative floor is a paste or a stray minus, and "free is
 * allowed" is a far better reading of it than a saved product whose floor
 * subtracts from the basket.
 */
function wholeCentsOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

/**
 * A whole non-negative count, or null — spec 51.
 *
 * The same blank-versus-zero rule `wholeCentsOrNull` above states, on the
 * columns where blank means "nobody has weighed it" and "no alert". A weight of
 * zero and no weight at all are different facts and `basketWeightGrams` reads
 * them the same way only because neither adds anything; a threshold of zero is
 * a real setting, meaning "tell me when it is gone".
 */
function wholeCountOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

/** Blank is "no answer" and stores as null, which is not the empty string. */
function trimmed(value: unknown, max: number): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? raw.slice(0, max) : null;
}

export async function saveProduct(
  shop: Shop,
  input: ProductInput,
): Promise<SaveProductResult> {
  const db = getDb();

  const title = input.title.trim();
  if (!title) return refuse({ kind: "no_title" });

  const kind = isProductKind(input.kind) ? input.kind : "physical";
  const modeRaw = input.serviceMode ?? "in_person";
  const mode = isServiceMode(modeRaw) ? modeRaw : "in_person";

  const categoryId = input.categoryId?.trim() || null;
  if (categoryId) {
    const owned = await db.query.categories.findFirst({
      where: and(eq(categories.id, categoryId), eq(categories.shopId, shop.id)),
      columns: { id: true },
    });
    if (!owned) return refuse({ kind: "unknown_category" });
  }

  const options = normalizeOptions(input.options ?? []);
  const variants = usable(options, input.variants ?? []);
  // Options with nothing sellable under them would render a picker that can't
  // produce an order, so the product falls back to being sold as one thing.
  const hasVariants = variants.length > 0;

  const eventStartsAt = input.eventStartsAt ?? null;
  if (kind === "event" && !eventStartsAt) {
    return refuse({ kind: "event_needs_start" });
  }

  /*
   * An end before its own start, refused rather than stored.
   *
   * It is almost always a date the seller did not change after picking the
   * start, and the two places it surfaces — the buyer's page and their
   * calendar — would render a negative span that reads as a mistake nobody
   * can explain. Cheaper to say so while they are looking at the field.
   */
  const eventEndsAt = input.eventEndsAt ?? null;
  if (
    kind === "event" &&
    eventEndsAt &&
    eventStartsAt &&
    eventEndsAt.getTime() <= eventStartsAt.getTime()
  ) {
    return refuse({ kind: "event_ends_before_start" });
  }

  /*
   * What a digital product actually hands over.
   *
   * `link` and `code` are refused when blank, where a fileless download is
   * not — see the note on `digital_needs_delivery` for why the asymmetry is
   * the right way round. The URL gets `isPublicLinkUrl`, the same check the
   * event join link and the terms link get: it is rendered as an anchor in an
   * email and on the buyer's page, so `javascript:` and internal hosts are not
   * things a seller may put in front of their buyers.
   */
  const delivery = isDigitalDelivery(input.digitalDelivery)
    ? input.digitalDelivery
    : "file";
  const digitalLinkUrl = input.digitalLinkUrl?.trim() || "";
  const digitalAccessDetails = trimmed(input.digitalAccessDetails, 2000);

  if (kind === "digital" && delivery === "link") {
    // A pooled link product has no single URL to demand — see `codeSource`
    // below. Each pooled URL is guarded at `addCodes`, where it arrives.
    if (!digitalLinkUrl && !isCodeSource(input.codeSource)) {
      return refuse({ kind: "digital_needs_delivery", delivery: "link" });
    }
    if (digitalLinkUrl && !isPublicLinkUrl(digitalLinkUrl)) {
      return refuse({ kind: "digital_link_not_public" });
    }
  }
  /*
   * Where a code comes from — spec 48.
   *
   * `pool` and `generated` are gated on `codePools`; a shop without the plan
   * falls back to null, which is the shared string and today's behaviour, so
   * downgrading a shop never breaks a product — it stops handing out one code
   * per buyer and starts handing out the one the seller typed. The alternative
   * (refusing the save) would leave a seller unable to edit a title on a
   * product they configured while they were on Pro.
   */
  const codeSource =
    kind === "digital" && can(shop, "codePools") && isCodeSource(input.codeSource)
      ? input.codeSource
      : null;

  let codePattern: string | null = null;
  if (codeSource === "generated") {
    const checked = checkCodePattern(input.codePattern ?? DEFAULT_CODE_PATTERN);
    if (!checked.ok) return refuse({ kind: "code_pattern_invalid", reason: checked.reason });
    codePattern = checked.pattern;
  }

  /*
   * The shared string is required only when it is the thing being handed over.
   *
   * A product drawing from a pool has no single string to type, so demanding
   * one would make the feature unreachable — the seller would have to invent a
   * placeholder that every buyer would then never see.
   */
  if (kind === "digital" && delivery === "code" && !codeSource && !digitalAccessDetails) {
    return refuse({ kind: "digital_needs_delivery", delivery: "code" });
  }
  /*
   * Same, for `link`: a pool of one-seat invite URLs has no single URL. The
   * check above already refused a blank `digitalLinkUrl`, so this widens it
   * back for the pooled case only — each pooled URL goes through the identical
   * `isPublicLinkUrl` guard at `addCodes`, at the write, where the value
   * actually arrives.
   */

  const licenseEnabled =
    kind === "digital" && can(shop, "licensing") && input.licenseEnabled === true;

  /*
   * The join link for an online event — refused rather than quietly dropped.
   *
   * A dropped link saves the rest of the form and leaves the seller believing
   * their webinar has a way in. Nobody finds out until the reminder goes out
   * an hour before it starts with nothing to click, which is the worst
   * possible moment to discover a typo. `isPublicLinkUrl` is the same check
   * the terms link gets: this is rendered as an anchor in an email and on the
   * buyer's page, so `javascript:` and internal hosts are not things a seller
   * may put in front of their buyers.
   */
  const joinUrl = input.eventJoinUrl?.trim() || "";
  if (joinUrl && !isPublicLinkUrl(joinUrl)) {
    return refuse({ kind: "join_url_not_public" });
  }

  /*
   * A membership has to be billable before it can be saved as one.
   *
   * Both refusals turn a Stripe error the *buyer* would have met at checkout
   * into something the seller can act on while they are still looking at the
   * product: Stripe will not create a recurring price for nothing, and it has
   * no way to guess how often to charge. Checked here rather than only in
   * `membershipSellable` so a shop can never publish one that cannot be sold.
   */
  const billingInterval = isBillingInterval(input.billingInterval)
    ? input.billingInterval
    : null;
  /*
   * Clamped rather than refused. "Every 400 days" is a typo for something, and
   * the nearest legal cycle is a better answer than a saved product Stripe
   * will not create a Price for — which the seller would only discover when a
   * buyer met the failure at checkout.
   */
  const billingIntervalCount = billingInterval
    ? normalizeIntervalCount(input.billingIntervalCount ?? 1, billingInterval)
    : 1;
  if (kind === "membership") {
    if (!billingInterval) return refuse({ kind: "membership_needs_interval" });
    if (input.priceCents <= 0) return refuse({ kind: "membership_needs_price" });
  }

  /*
   * How the price is arrived at, and when the product is on sale — spec 43.
   *
   * Both are gated on the plan *here* rather than only in the form, because a
   * downgraded shop must not keep selling on a windowed schedule its plan no
   * longer includes and a hand-rolled POST is not a form. Falling back to
   * `fixed` and no window is the safe direction on both counts: the product
   * goes on selling at its list price, all the time, which is what it did
   * before any of these columns existed.
   *
   * The seller's stored numbers are *not* wiped by the downgrade — only
   * ignored — so an upgrade brings back the launch they configured rather than
   * a blank card. That is the same trade `atProductLimit` makes when it applies
   * the cap to new products only: a downgrade never deletes work.
   */
  const pricingAllowed = can(shop, "pricingModes");

  const pricingMode = pricingAllowed
    ? normalizePricingMode(input.pricingMode, kind)
    : "fixed";

  /*
   * PWYW on a membership is refused rather than quietly downgraded to `fixed`.
   *
   * `normalizePricingMode` would fall back silently, which is right for a typo
   * arriving from an API caller and wrong for a seller who has just ticked a
   * box: they would save, see nothing, and go on believing their gym takes
   * whatever members feel like paying.
   */
  if (kind === "membership" && input.pricingMode === "pwyw" && pricingAllowed) {
    return refuse({ kind: "pwyw_not_for_membership" });
  }

  const sellFrom = pricingAllowed ? (input.sellFrom ?? null) : null;
  const sellUntil = pricingAllowed ? (input.sellUntil ?? null) : null;
  if (sellFrom && sellUntil && sellUntil.getTime() <= sellFrom.getTime()) {
    return refuse({ kind: "sell_window_inverted" });
  }

  /*
   * A lead product is free, and that is decided here rather than on the form —
   * spec 07 says so in as many words.
   *
   * The form hides the price field, which is a claim the *client* makes: a
   * server action takes whatever it is sent, so a posted `priceCents` would
   * otherwise be stored and a "free" enquiry form would quietly have a price
   * on it. Forced to `0` and never to null: blank is not zero, and this column
   * is not nullable — zero is the honest value for a thing that costs nothing.
   */
  const priceCents = kind === "lead" ? 0 : input.priceCents;
  const compareAtCents = kind === "lead" ? null : (input.compareAtCents ?? null);
  const trackInventory = input.trackInventory === true;

  const values = {
    title,
    description: input.description?.trim() || null,
    priceCents,
    compareAtCents:
      compareAtCents !== null && compareAtCents <= priceCents ? null : compareAtCents,
    /*
     * The same price in the shop's other currencies — spec 53.
     *
     * Written whole rather than merged, so clearing a field clears the entry
     * and the currency stops being offered. A merge would leave a price a
     * seller had deliberately removed still quoted on their storefront, which
     * is the worse direction by a distance.
     *
     * A compare-at below its own currency's price is dropped for the same
     * reason it is above: a strike-through that is not a saving is an
     * advertisement for a discount nobody is giving.
     */
    currencyPrices: kind === "lead" ? {} : droppingWeakCompareAt(input.currencyPrices ?? {}),

    /*
     * The enquiry form's questions, and empty for every other kind.
     *
     * Cleared rather than left alone when the kind changes, for the same
     * reason `digitalAccessDetails` is: a product switched from an enquiry
     * form to something sold would otherwise keep a form nothing renders,
     * waiting to reappear the day somebody switches it back and wonders where
     * the old questions came from.
     */
    leadQuestions:
      kind === "lead" ? normalizeQuestions(input.leadQuestions ?? []) : [],

    /* ---- Spec 43 -------------------------------------------------------- */

    pricingMode,
    /*
     * Blank stays blank, and that is the whole rule on these two.
     *
     * `null` means "not configured", which `pwywFloorCents` reads as the list
     * price; `0` means "free is allowed". A normaliser that folded one into the
     * other would either make every unconfigured PWYW product free or make
     * every donation impossible, and both failures are silent. So the only
     * thing done here is truncating a fractional minor unit and refusing a
     * negative, neither of which is a number a seller can mean.
     */
    minPriceCents: wholeCentsOrNull(input.minPriceCents),
    suggestedPriceCents: wholeCentsOrNull(input.suggestedPriceCents),
    /*
     * Kept on every kind rather than cleared off the ones that rarely use
     * them, matching `bookingLeadHours` and `durationMinutes`: a launch window
     * is as meaningful on a digital download as on a run of mugs, and nothing
     * reads these but `sellWindowState`.
     */
    sellFrom,
    sellUntil,
    hideWhenUnavailable: pricingAllowed && input.hideWhenUnavailable === true,

    kind,
    categoryId,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, MAX_TAGS),
    options: hasVariants ? options : [],

    /*
     * The product's own code, kept only where it can be read. A product with
     * options carries its codes on the variants, and the order line snapshots
     * whichever applies — so a second code up here would be one no order can
     * ever quote and one more thing to keep in step.
     */
    sku: hasVariants ? null : trimmed(input.sku, 60),
    /*
     * Zero and null both mean "no cap". A seller who wants to stop selling has
     * `inStock`, and a zero here is far more likely a cleared field than a
     * deliberate embargo — one that would render a quantity picker whose only
     * legal value is none.
     */
    maxPerOrder: (() => {
      const raw = input.maxPerOrder ?? null;
      if (raw === null || !Number.isFinite(raw)) return null;
      const cap = Math.trunc(raw);
      return cap > 0 ? Math.min(cap, MAX_QUANTITY) : null;
    })(),

    /*
     * Spec 51. Kept on every kind rather than cleared off the non-physical
     * ones, matching `bookingLeadHours` above: nothing reads a weight but the
     * band table, a product switched between kinds keeps what the seller typed,
     * and a digital product that also ships a printed copy is an ordinary thing
     * to sell.
     *
     * `lowStockThreshold` is not gated on the plan. It prevents a loss rather
     * than creating a sale, and gating it would price the smallest shops out of
     * knowing their own stockroom.
     */
    lowStockThreshold: wholeCountOrNull(input.lowStockThreshold),

    /*
     * Spec 33. Kept on every kind rather than cleared off the ones that rarely
     * use it, matching the weight columns above: a workshop run twice a year
     * and a print run are both things a seller takes orders for before they
     * exist, and nothing reads these but `takesPreorders` and the buy box.
     *
     * The date is stored as given. It is *snapshotted onto the order* at
     * checkout, so a seller slipping it next month changes what future buyers
     * are told and not what past ones were promised — which is the whole reason
     * the order carries its own copy.
     */
    preorderEnabled: input.preorderEnabled === true,
    preorderExpectedAt: input.preorderExpectedAt ?? null,
    preorderLimit: wholeCountOrNull(input.preorderLimit),
    weightGrams: wholeCountOrNull(input.weightGrams),
    lengthMm: wholeCountOrNull(input.lengthMm),
    widthMm: wholeCountOrNull(input.widthMm),
    heightMm: wholeCountOrNull(input.heightMm),

    trackInventory,
    // Stock lives on the variants when there are any, so the product-level
    // count must not linger and contradict them.
    stockQuantity:
      trackInventory && !hasVariants ? (input.stockQuantity ?? null) : null,

    // Digital delivery. The shape is the product's, so the two fields that
    // do not belong to the chosen shape are cleared — a seller who moves a
    // product from a link to a file must not leave a live URL behind that the
    // download page would still be entitled to render.
    digitalDelivery: kind === "digital" ? delivery : "file",
    digitalLinkUrl:
      kind === "digital" && delivery === "link" ? digitalLinkUrl : null,
    digitalAccessDetails:
      kind === "digital" && delivery === "code" ? digitalAccessDetails : null,

    /*
     * Spec 48. Cleared off every other kind, exactly as the three columns
     * above are: a product switched away from being digital must not keep a
     * pool it would silently start drawing from if it were switched back.
     *
     * The pool rows themselves are left alone — they are the seller's
     * inventory and their claimed half is a buyer's — so switching a product
     * to physical and back finds the codes where they were.
     */
    codeSource,
    codePattern,
    licenseEnabled,
    licenseActivationLimit: licenseEnabled
      ? wholeCountOrNull(input.licenseActivationLimit)
      : null,
    licenseDays: licenseEnabled ? wholeCountOrNull(input.licenseDays) : null,
    releaseOnPayment: input.releaseOnPayment === true,
    downloadLimit: input.downloadLimit ?? null,
    downloadExpiryDays: input.downloadExpiryDays ?? null,

    // Services
    durationMinutes: input.durationMinutes ?? null,
    serviceMode: mode,
    serviceLocation: trimmed(input.serviceLocation, 500),
    bookingEnabled: input.bookingEnabled === true,
    bookingLeadHours: input.bookingLeadHours ?? 0,
    /*
     * Kept on every kind rather than cleared off the non-services, matching
     * `bookingLeadHours` and `durationMinutes` directly above: a product
     * switched to a service and back keeps the seller's settings, and none of
     * the three is read by anything but `isBookable`.
     */
    bookingBufferMinutes: Math.min(
      Math.max(0, Math.trunc(input.bookingBufferMinutes ?? 0)),
      // A buffer longer than a day is not a buffer, it is a closed diary.
      24 * 60,
    ),

    // Events. Cleared on other kinds so a product switched away from being
    // an event doesn't keep silently closing its own sales at a stale date.
    eventStartsAt: kind === "event" ? eventStartsAt : null,
    eventEndsAt: kind === "event" ? eventEndsAt : null,
    /*
     * Held to the same two conditions the buyer's page checks. An in-person
     * event keeps no link — a venue is not joined — and a product switched
     * away from being an event keeps none either, so a stale Zoom room can
     * never be handed to the buyer of something else.
     */
    eventJoinUrl: kind === "event" && mode === "online" ? joinUrl || null : null,

    /*
     * Memberships. Cleared on every other kind, so a product switched away
     * from being one cannot keep a billing interval that nothing reads and
     * that a later switch back would silently resurrect.
     *
     * `stripePriceId` is deliberately *not* cleared on a price change. A
     * Stripe Price is immutable, so existing members stay on the one they
     * signed up at; `priceIsStale` notices the difference at the next
     * subscribe and mints a new Price then. Clearing it here would orphan the
     * cached id without telling anybody, and re-create an identical Price on
     * every save.
     */
    billingInterval: kind === "membership" ? billingInterval : null,
    billingIntervalCount: kind === "membership" ? billingIntervalCount : 1,
    trialDays: kind === "membership" ? normalizeTrialDays(input.trialDays) : null,

    inStock: input.inStock === true,
    isFeatured: input.isFeatured === true,
    isPublished: input.isPublished === true,
    updatedAt: new Date(),
  };

  // Product cap applies to new products only — a downgrade never deletes work.
  if (!input.id) {
    const [counted] = await db
      .select({ count: sql<string>`count(*)` })
      .from(products)
      .where(eq(products.shopId, shop.id));

    if (atProductLimit(shop, Number(counted?.count ?? 0))) {
      return refuse({
        kind: "product_limit",
        // Returned rather than rendered: the seller is being told to upgrade
        // and the number is the whole reason the sentence lands.
        limit: productLimit(shop) ?? 0,
        planName: planFor(shop).name,
      });
    }
  }

  const imageUrls = (input.imageUrls ?? [])
    .map((url) => url.trim())
    .filter(isRenderableImageUrl)
    .slice(0, MAX_IMAGES);

  const slug = await uniqueSlug(
    shop.id,
    slugify(title),
    input.id ?? undefined,
  );

  let productId = input.id;
  const created = !input.id;

  if (input.id) {
    const owned = await db.query.products.findFirst({
      where: and(eq(products.id, input.id), eq(products.shopId, shop.id)),
      columns: { id: true, slug: true },
    });
    // "Not yours" and "doesn't exist" are one answer, as everywhere else.
    if (!owned) return refuse({ kind: "not_found" });

    await db
      .update(products)
      .set({ ...values, slug })
      .where(eq(products.id, input.id));

    // Images are managed as a set — replace wholesale.
    await db.delete(productImages).where(eq(productImages.productId, input.id));
  } else {
    const [maxed] = await db
      .select({ max: sql<string>`coalesce(max(${products.position}), 0)` })
      .from(products)
      .where(eq(products.shopId, shop.id));

    const [row] = await db
      .insert(products)
      .values({
        ...values,
        shopId: shop.id,
        slug,
        position: Number(maxed?.max ?? 0) + 1,
      })
      .returning({ id: products.id });
    if (!row) throw new Error("product was not inserted");
    productId = row.id;
  }

  /*
   * Narrowed rather than asserted.
   *
   * This was `productId!`, with a comment explaining that the closures below
   * cannot see through the branch. True, and the assertion made the compiler
   * agree by fiat: if a future edit ever leaves a path where neither branch
   * assigns, `!` says nothing and the id reaches an insert as `undefined`.
   * Throwing states the invariant instead, and costs a comparison that never
   * fires.
   */
  if (!productId) throw new Error("product id was never bound");
  const savedId = productId;

  if (imageUrls.length) {
    await db.insert(productImages).values(
      imageUrls.map((url, i) => ({ productId: savedId, url, position: i })),
    );
  }

  await syncVariants(savedId, hasVariants ? options : [], variants, trackInventory);
  /*
   * A digital product that delivers a link or a code keeps no files.
   *
   * Only that case is cleared here. Any other kind may still carry an
   * attachment — a care card with a mug, a worksheet with a class — and the
   * download page has always handed those over; taking them away would be a
   * silent deletion of things sellers are already shipping.
   *
   * What is not allowed is a *digital* product whose stated shape is a link
   * while a file sits behind it: the streaming route keys off the order's
   * token rather than the product's kind, so the leftover file would go on
   * being downloadable as though it were the good.
   */
  const keepsFiles = !(kind === "digital" && delivery !== "file");
  await syncFiles(savedId, keepsFiles ? (input.files ?? []) : []);

  return { ok: true, id: savedId, slug, created };
}

function refuse(refusal: SaveProductRefusal): SaveProductResult {
  return { ok: false, refusal };
}

/**
 * Deleting, scoped in the WHERE.
 *
 * Answers whether a row went, so a caller can tell "gone" from "never yours"
 * without a read that would have raced the delete anyway.
 */
export async function deleteProduct(
  shopId: string,
  productId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .delete(products)
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
    .returning({ id: products.id });
  return Boolean(row);
}

/**
 * Flipping published, in SQL rather than read-then-write.
 *
 * `not is_published` in the statement means two taps racing — the phone and an
 * open admin tab — cannot both read `false` and both write `true`, leaving the
 * seller pressing a switch that does nothing. The new value comes back so the
 * caller can say which way it went.
 */
export async function toggleProductPublished(
  shopId: string,
  productId: string,
): Promise<boolean | null> {
  const [row] = await getDb()
    .update(products)
    .set({ isPublished: sql`not ${products.isPublished}`, updatedAt: new Date() })
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
    .returning({ isPublished: products.isPublished });
  return row ? row.isPublished : null;
}
