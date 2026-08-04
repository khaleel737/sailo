"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, productImages, products } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { parseMoneyToCents, slugify } from "@/lib/utils";
import type { ActionState } from "./shop";

const KINDS = new Set(["physical", "digital", "service"]);

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

function readImageUrls(formData: FormData) {
  return formData
    .getAll("imageUrls")
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, 8);
}

function readTags(formData: FormData) {
  return String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
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
  const kind = KINDS.has(kindRaw) ? kindRaw : "physical";

  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;
  if (categoryId) {
    const owned = await db.query.categories.findFirst({
      where: and(eq(categories.id, categoryId), eq(categories.shopId, shop.id)),
      columns: { id: true },
    });
    if (!owned) return { ok: false, error: "That category doesn't exist." };
  }

  const compareRaw = String(formData.get("compareAtPrice") ?? "").trim();
  const values = {
    title,
    description: String(formData.get("description") ?? "").trim() || null,
    priceCents: parseMoneyToCents(String(formData.get("price") ?? "0")),
    compareAtCents: compareRaw ? parseMoneyToCents(compareRaw) : null,
    kind,
    categoryId,
    tags: readTags(formData),
    inStock: formData.get("inStock") === "on",
    isFeatured: formData.get("isFeatured") === "on",
    isPublished: formData.get("isPublished") === "on",
    updatedAt: new Date(),
  };

  const urls = readImageUrls(formData);
  let productId = id;

  if (id) {
    const owned = await db.query.products.findFirst({
      where: and(eq(products.id, id), eq(products.shopId, shop.id)),
      columns: { id: true, slug: true },
    });
    if (!owned) return { ok: false, error: "Product not found." };

    await db
      .update(products)
      .set({ ...values, slug: await uniqueSlug(shop.id, slugify(title), id) })
      .where(eq(products.id, id));

    // Images are managed as a set — replace wholesale.
    await db.delete(productImages).where(eq(productImages.productId, id));
  } else {
    const [{ max }] = await db
      .select({ max: sql<string>`coalesce(max(${products.position}), 0)` })
      .from(products)
      .where(eq(products.shopId, shop.id));

    const [created] = await db
      .insert(products)
      .values({
        ...values,
        shopId: shop.id,
        slug: await uniqueSlug(shop.id, slugify(title)),
        position: Number(max) + 1,
      })
      .returning({ id: products.id });
    productId = created.id;
  }

  if (productId && urls.length) {
    await db.insert(productImages).values(
      urls.map((url, i) => ({ productId: productId!, url, position: i })),
    );
  }

  revalidatePath("/admin/products");
  revalidatePath(`/${shop.handle}`);
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

  const [{ max }] = await db
    .select({ max: sql<string>`coalesce(max(${categories.position}), 0)` })
    .from(categories)
    .where(eq(categories.shopId, shop.id));

  await db
    .insert(categories)
    .values({ shopId: shop.id, name, slug, position: Number(max) + 1 });

  revalidatePath("/admin/categories");
  revalidatePath(`/${shop.handle}`);
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
}
