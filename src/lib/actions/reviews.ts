"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { products, reviews, shops } from "@/db/schema";
import { requireShop } from "@/lib/session";
import type { ActionState } from "./shop";

/** Public submission — always lands unapproved so sellers moderate. */
export async function submitReview(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = getDb();
  const productId = String(formData.get("productId") ?? "");
  const rating = Number(formData.get("rating"));
  const authorName = String(formData.get("authorName") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!productId) return { ok: false, error: "Missing product." };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return { ok: false, error: "Pick a rating from 1 to 5." };
  if (!authorName) return { ok: false, error: "Add your name." };

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.isPublished, true)),
    columns: { id: true, shopId: true, slug: true },
  });
  if (!product) return { ok: false, error: "Product not found." };

  await db.insert(reviews).values({
    shopId: product.shopId,
    productId: product.id,
    authorName: authorName.slice(0, 80),
    rating,
    body: body.slice(0, 1000) || null,
  });

  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, product.shopId),
    columns: { handle: true },
  });
  if (shop) revalidatePath(`/${shop.handle}/p/${product.slug}`);
  revalidatePath("/admin/reviews");

  return { ok: true, message: "Thanks! Your review is awaiting approval." };
}

export async function approveReview(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .update(reviews)
    .set({ isApproved: true })
    .where(and(eq(reviews.id, id), eq(reviews.shopId, shop.id)));

  revalidatePath("/admin/reviews");
  revalidatePath(`/${shop.handle}`);
}

export async function deleteReview(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(reviews)
    .where(and(eq(reviews.id, id), eq(reviews.shopId, shop.id)));

  revalidatePath("/admin/reviews");
  revalidatePath(`/${shop.handle}`);
}
