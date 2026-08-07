"use server";

import { revalidatePath } from "next/cache";
import { revalidateShop } from "@/lib/cache";
import { firstRow } from "@/lib/invariant";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { isStoredFileUrl } from "@/lib/file-urls";
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
import { categories, productFiles, productImages, products, productVariants, type ProductOption } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { parseMoneyToCents, slugify } from "@/lib/utils";
import { atProductLimit, planFor, productLimit } from "@/lib/plans";
import { isProductKind, isServiceMode, normalizeOptions, optionKey } from "@/lib/variants";
import type { ActionState } from "./shop";

const MAX_FILES = 10;

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
 * Variants are matched on their combination rather than replaced wholesale:
 * past orders point at a variant row, and dropping it would blank the link
 * every time the seller saves an unrelated edit.
 */
async function syncVariants(
  productId: string,
  options: ProductOption[],
  rows: VariantRow[],
  trackInventory: boolean,
) {
  const db = getDb();
  const wanted = usableVariants(options, rows);

  const existing = await db.query.productVariants.findMany({
    where: eq(productVariants.productId, productId),
  });
  const byKey = new Map(existing.map((v) => [optionKey(v.options), v]));

  for (const [position, row] of wanted.entries()) {
    const priceCents = optionalCents(row.price);
    const values = {
      options: row.options,
      sku: text(row.sku, 60),
      priceCents,
      // A strike-through only means something next to its own price.
      compareAtCents: (() => {
        const compare = optionalCents(row.compareAt);
        return compare !== null && priceCents !== null && compare <= priceCents
          ? null
          : compare;
      })(),
      stockQuantity: trackInventory ? optionalCount(row.stock) : null,
      isAvailable: row.available !== false,
      imageUrl: text(row.image, 500),
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

async function syncFiles(productId: string, rows: FileRow[]) {
  const db = getDb();
  /*
   * The host, not just the scheme.
   *
   * `flatMap` rather than `filter` because `filter` narrows nothing: a later
   * `f.url` would have to be asserted despite the line above having proved it.
   *
   * This checked `^https?://` and nothing else, which is no check at all: a
   * server action takes whatever the client posts, so the upload widget is not
   * a gate. Any URL stored here is later fetched *server-side* by
   * `/api/download/[token]/[fileId]`, whose response is streamed back to the
   * caller — so a seller, and signup is open, could point a file at a cloud
   * metadata endpoint or anything else the function can reach, buy their own
   * product, and read the reply.
   */
  const usable = rows
    .flatMap((f) => (isStoredFileUrl(f.url) ? [{ ...f, url: f.url }] : []))
    .slice(0, MAX_FILES);

  await db.delete(productFiles).where(eq(productFiles.productId, productId));
  if (!usable.length) return;

  await db.insert(productFiles).values(
    usable.map((f, position) => ({
      productId,
      name: text(f.name, 200) ?? "Download",
      url: f.url,
      sizeBytes:
        typeof f.sizeBytes === "number" && Number.isFinite(f.sizeBytes)
          ? Math.max(0, Math.trunc(f.sizeBytes))
          : null,
      contentType: text(f.contentType, 120),
      position,
    })),
  );
}

export async function saveProduct(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();
  const db = getDb();

  const id = String(formData.get("id") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "Product needs a title." };

  const kindRaw = String(formData.get("kind") ?? "physical");
  const kind = isProductKind(kindRaw) ? kindRaw : "physical";

  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;
  if (categoryId) {
    const owned = await db.query.categories.findFirst({
      where: and(eq(categories.id, categoryId), eq(categories.shopId, shop.id)),
      columns: { id: true },
    });
    if (!owned) return { ok: false, error: "That category doesn't exist." };
  }

  /* ---- Options and variants -------------------------------------------- */

  const options = normalizeOptions(
    readJson<ProductOption[]>(formData.get("options")) ?? [],
  );
  const variantRows = usableVariants(
    options,
    readJsonRows<VariantRow>(formData, "variants"),
  );
  // Options with nothing sellable under them would render a picker that can't
  // produce an order, so the product falls back to being sold as one thing.
  const hasVariants = variantRows.length > 0;

  /* ---- Inventory -------------------------------------------------------- */

  const trackInventory = formData.get("trackInventory") === "on";

  const modeRaw = String(formData.get("serviceMode") ?? "in_person");
  const compareRaw = String(formData.get("compareAtPrice") ?? "").trim();
  const priceCents = parseMoneyToCents(String(formData.get("price") ?? "0"));
  const compareAtCents = compareRaw ? parseMoneyToCents(compareRaw) : null;

  const values = {
    title,
    description: String(formData.get("description") ?? "").trim() || null,
    priceCents,
    compareAtCents:
      compareAtCents !== null && compareAtCents <= priceCents
        ? null
        : compareAtCents,
    kind,
    categoryId,
    tags: readTags(formData),
    options: hasVariants ? options : [],

    trackInventory,
    // Stock lives on the variants when there are any, so the product-level
    // count must not linger and contradict them.
    stockQuantity:
      trackInventory && !hasVariants
        ? optionalCount(formData.get("stockQuantity"))
        : null,

    // Digital delivery
    releaseOnPayment: formData.get("releaseOnPayment") === "on",
    downloadLimit: optionalCount(formData.get("downloadLimit"), 1000),
    downloadExpiryDays: optionalCount(formData.get("downloadExpiryDays"), 3650),

    // Services
    durationMinutes: optionalCount(formData.get("durationMinutes"), 60 * 24 * 30),
    serviceMode: isServiceMode(modeRaw) ? modeRaw : "in_person",
    serviceLocation: text(formData.get("serviceLocation"), 500),
    bookingEnabled: formData.get("bookingEnabled") === "on",
    bookingLeadHours: optionalCount(formData.get("bookingLeadHours"), 24 * 365) ?? 0,

    inStock: formData.get("inStock") === "on",
    isFeatured: formData.get("isFeatured") === "on",
    isPublished: formData.get("isPublished") === "on",
    updatedAt: new Date(),
  };

  // Product cap applies to new products only — a downgrade never deletes work.
  if (!id) {
    const { count: existing } = firstRow(await db
      .select({ count: sql<string>`count(*)` })
      .from(products)
      .where(eq(products.shopId, shop.id)), "count aggregate");

    if (atProductLimit(shop, Number(existing))) {
      const limit = productLimit(shop);
      return {
        ok: false,
        error: `You've reached the ${limit}-product limit on ${planFor(shop).name}. Upgrade to add more.`,
      };
    }
  }

  const urls = readImageUrls(formData);
  let productId = id;
  const slug = await uniqueSlug(shop.id, slugify(title), id ?? undefined);

  if (id) {
    const owned = await db.query.products.findFirst({
      where: and(eq(products.id, id), eq(products.shopId, shop.id)),
      columns: { id: true, slug: true },
    });
    if (!owned) return { ok: false, error: "Product not found." };

    await db
      .update(products)
      .set({ ...values, slug })
      .where(eq(products.id, id));

    // Images are managed as a set — replace wholesale.
    await db.delete(productImages).where(eq(productImages.productId, id));
  } else {
    const { max } = firstRow(await db
      .select({ max: sql<string>`coalesce(max(${products.position}), 0)` })
      .from(products)
      .where(eq(products.shopId, shop.id)), "max aggregate");

    const created = firstRow(await db
      .insert(products)
      .values({
        ...values,
        shopId: shop.id,
        slug,
        position: Number(max) + 1,
      })
      .returning({ id: products.id }), "created");
    productId = created.id;
  }

  if (productId && urls.length) {
    // Bound outside the closure, which cannot see the guard above it.
    const savedId = productId;
    await db.insert(productImages).values(
      urls.map((url, i) => ({ productId: savedId, url, position: i })),
    );
  }

  if (productId) {
    await syncVariants(productId, hasVariants ? options : [], variantRows, trackInventory);
    await syncFiles(productId, readJsonRows<FileRow>(formData, "files"));
  }

  revalidatePath("/admin/products");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
  // Variant prices and stock live on the detail page too.
  revalidatePath(`/${shop.handle}/p/${slug}`);
  return { ok: true, message: id ? "Product updated." : "Product added." };
}

export async function deleteProduct(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(products)
    .where(and(eq(products.id, id), eq(products.shopId, shop.id)));

  revalidatePath("/admin/products");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
}

export async function toggleProductPublished(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .update(products)
    .set({ isPublished: sql`not ${products.isPublished}`, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.shopId, shop.id)));

  revalidatePath("/admin/products");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
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
}
