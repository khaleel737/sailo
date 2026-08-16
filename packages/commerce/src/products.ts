import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  categories,
  productFiles,
  productImages,
  productVariants,
  products,
  type ProductOption,
  type Shop,
  type VariantOptions,
} from "@sailo/db/schema";
import { atProductLimit, planFor, productLimit } from "@sailo/core/plans";
import {
  isPublicLinkUrl,
  isRenderableImageUrl,
  isStoredFileUrl,
} from "@sailo/storage/urls";
import { isBillingInterval, normalizeTrialDays } from "@sailo/core/memberships";
import { slugify } from "@sailo/core/slug";
import {
  MAX_VARIANTS,
  combinations,
  isProductKind,
  isServiceMode,
  normalizeOptions,
  optionKey,
} from "@sailo/core/variants";

/**
 * Writing a product, from whichever surface the seller used.
 *
 * `saveProduct` was 245 lines inside a `"use server"` file: FormData parsing,
 * the session check, every domain refusal, four table writes and the cache
 * invalidation, in one body. Only the middle of that is about what a product
 * *is*, and only the middle of it can be shared — a phone posts JSON, not a
 * form, and has no cache to drop.
 *
 * So the split is by what the input is rather than by what the code does. Above
 * this line a caller turns whatever it received into `ProductInput`: strings to
 * numbers, checkboxes to booleans, its own wording for whatever it refuses.
 * Below it, everything that must be true of the row no matter who asked — and
 * that includes the refusals, because a rule enforced only in the web form is a
 * rule a phone does not have.
 *
 * Two of those refusals are not conveniences. `isStoredFileUrl` is what stands
 * between a seller and `/api/download/[token]/[fileId]` fetching a URL of their
 * choosing server-side and handing them the reply; `isPublicLinkUrl` is what
 * stops a `javascript:` join link being mailed to a buyer. Both were in the web
 * action, and a `products.save` that did not repeat them would have been the
 * hole reopened by a different door.
 */

/** Images kept per product. The gallery is a set, replaced wholesale. */
export const MAX_IMAGES = 8;
/** Downloadable files per product. */
export const MAX_FILES = 10;
/** Tags per product. */
export const MAX_TAGS = 12;

export type ProductVariantInput = {
  options: VariantOptions;
  sku?: string | null;
  /** Null means "same as the product" — not free. */
  priceCents?: number | null;
  compareAtCents?: number | null;
  /** Null means "nobody is counting" — not sold out. */
  stockQuantity?: number | null;
  isAvailable?: boolean;
  imageUrl?: string | null;
};

export type ProductFileInput = {
  name?: string | null;
  url: string;
  sizeBytes?: number | null;
  contentType?: string | null;
};

/**
 * A product as the caller has already understood it — no strings that still
 * need parsing, no `FormDataEntryValue`, no wording.
 */
export type ProductInput = {
  /** Null creates. An id updates, and must already belong to this shop. */
  id: string | null;
  title: string;
  description?: string | null;
  priceCents: number;
  compareAtCents?: number | null;
  kind: string;
  categoryId?: string | null;
  tags?: string[];
  options?: ProductOption[];
  variants?: ProductVariantInput[];
  files?: ProductFileInput[];
  imageUrls?: string[];

  trackInventory?: boolean;
  stockQuantity?: number | null;

  releaseOnPayment?: boolean;
  downloadLimit?: number | null;
  downloadExpiryDays?: number | null;

  durationMinutes?: number | null;
  serviceMode?: string;
  serviceLocation?: string | null;
  bookingEnabled?: boolean;
  bookingLeadHours?: number;

  eventStartsAt?: Date | null;
  eventJoinUrl?: string | null;

  billingInterval?: string | null;
  trialDays?: number | null;

  inStock?: boolean;
  isFeatured?: boolean;
  isPublished?: boolean;
};

/**
 * Why a save was refused, as a value rather than a sentence.
 *
 * The web form answers in English inside an `ActionState`; a tRPC procedure
 * answers with a code the phone localises. Neither wording belongs here, and
 * putting one here would have meant the other translating it back.
 */
export type SaveProductRefusal =
  | { kind: "no_title" }
  | { kind: "unknown_category" }
  | { kind: "event_needs_start" }
  | { kind: "membership_needs_interval" }
  | { kind: "membership_needs_price" }
  | { kind: "join_url_not_public" }
  | { kind: "product_limit"; limit: number; planName: string }
  | { kind: "not_found" };

export type SaveProductResult =
  | { ok: true; id: string; slug: string; created: boolean }
  | { ok: false; refusal: SaveProductRefusal };

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
      stockQuantity: trackInventory ? (row.stockQuantity ?? null) : null,
      isAvailable: row.isAvailable !== false,
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

  await db.delete(productFiles).where(eq(productFiles.productId, productId));
  if (!kept.length) return;

  await db.insert(productFiles).values(
    kept.map((f, position) => ({
      productId,
      name: trimmed(f.name, 200) ?? "Download",
      url: f.url,
      sizeBytes:
        typeof f.sizeBytes === "number" && Number.isFinite(f.sizeBytes)
          ? Math.max(0, Math.trunc(f.sizeBytes))
          : null,
      contentType: trimmed(f.contentType, 120),
      position,
    })),
  );
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
  if (kind === "membership") {
    if (!billingInterval) return refuse({ kind: "membership_needs_interval" });
    if (input.priceCents <= 0) return refuse({ kind: "membership_needs_price" });
  }

  const priceCents = input.priceCents;
  const compareAtCents = input.compareAtCents ?? null;
  const trackInventory = input.trackInventory === true;

  const values = {
    title,
    description: input.description?.trim() || null,
    priceCents,
    compareAtCents:
      compareAtCents !== null && compareAtCents <= priceCents ? null : compareAtCents,
    kind,
    categoryId,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, MAX_TAGS),
    options: hasVariants ? options : [],

    trackInventory,
    // Stock lives on the variants when there are any, so the product-level
    // count must not linger and contradict them.
    stockQuantity:
      trackInventory && !hasVariants ? (input.stockQuantity ?? null) : null,

    // Digital delivery
    releaseOnPayment: input.releaseOnPayment === true,
    downloadLimit: input.downloadLimit ?? null,
    downloadExpiryDays: input.downloadExpiryDays ?? null,

    // Services
    durationMinutes: input.durationMinutes ?? null,
    serviceMode: mode,
    serviceLocation: trimmed(input.serviceLocation, 500),
    bookingEnabled: input.bookingEnabled === true,
    bookingLeadHours: input.bookingLeadHours ?? 0,

    // Events. Cleared on other kinds so a product switched away from being
    // an event doesn't keep silently closing its own sales at a stale date.
    eventStartsAt: kind === "event" ? eventStartsAt : null,
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

  // Bound outside the branch, which the closures below cannot see through.
  const savedId = productId!;

  if (imageUrls.length) {
    await db.insert(productImages).values(
      imageUrls.map((url, i) => ({ productId: savedId, url, position: i })),
    );
  }

  await syncVariants(savedId, hasVariants ? options : [], variants, trackInventory);
  await syncFiles(savedId, input.files ?? []);

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
