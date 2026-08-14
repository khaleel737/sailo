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
  usableVariants,
  type FileRow,
  type VariantRow,
} from "@/lib/products/form-fields";
import { categories, type ProductOption } from "@sailo/db/schema";
import {
  deleteProduct as deleteProductRow,
  saveProduct as saveProductRow,
  toggleProductPublished as togglePublishedRow,
  type ProductInput,
  type SaveProductRefusal,
} from "@sailo/commerce/products";
import { requireShop } from "@/lib/session";
import { parseMoneyToCents, slugify } from "@/lib/utils";
import { isProductKind } from "@sailo/core/variants";
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
    case "membership_needs_interval":
      return "Choose how often a membership is charged.";
    case "membership_needs_price":
      return "A membership needs a price to charge.";
    case "join_url_not_public":
      return "The join link must be a public https:// address.";
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
 */
function readEventStart(formData: FormData): Date | null {
  const raw = String(formData.get("eventStartsAt") ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The form, as the domain understands it. Every string is already a value. */
function readProduct(formData: FormData, currency: string): ProductInput {
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
    kind,
    categoryId: String(formData.get("categoryId") ?? ""),
    tags: readTags(formData),
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
      // Blank is "nobody is counting", which is not the same as sold out.
      stockQuantity: optionalCount(row.stock),
      isAvailable: row.available !== false,
      imageUrl: typeof row.image === "string" ? row.image : null,
    })),

    files: readJsonRows<FileRow>(formData, "files").flatMap((f) =>
      typeof f.url === "string" ? [{ ...f, url: f.url }] : [],
    ),
    imageUrls: readImageUrls(formData),

    trackInventory: formData.get("trackInventory") === "on",
    stockQuantity: optionalCount(formData.get("stockQuantity")),

    releaseOnPayment: formData.get("releaseOnPayment") === "on",
    downloadLimit: optionalCount(formData.get("downloadLimit"), 1000),
    downloadExpiryDays: optionalCount(formData.get("downloadExpiryDays"), 3650),

    durationMinutes: optionalCount(formData.get("durationMinutes"), 60 * 24 * 30),
    serviceMode: String(formData.get("serviceMode") ?? "in_person"),
    serviceLocation: text(formData.get("serviceLocation"), 500),
    bookingEnabled: formData.get("bookingEnabled") === "on",
    bookingLeadHours: optionalCount(formData.get("bookingLeadHours"), 24 * 365) ?? 0,

    eventStartsAt: readEventStart(formData),
    eventJoinUrl: String(formData.get("eventJoinUrl") ?? ""),

    billingInterval: String(formData.get("billingInterval") ?? ""),
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
  const { shop } = await requireShop();

  const result = await saveProductRow(shop, readProduct(formData, shop.currency));
  if (!result.ok) return { ok: false, error: sentenceFor(result.refusal) };

  dropCatalogueCaches(shop, result.slug);
  return {
    ok: true,
    message: result.created ? "Product added." : "Product updated.",
  };
}

export async function deleteProduct(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await deleteProductRow(shop.id, id);
  dropCatalogueCaches(shop);
}

export async function toggleProductPublished(formData: FormData) {
  const { shop } = await requireShop();
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
  const { shop } = await requireShop();
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
  const { shop } = await requireShop();
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
