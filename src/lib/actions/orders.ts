"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, products, shops } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { buildWhatsAppUrl, formatMoney } from "@/lib/utils";

const STATUSES = new Set(["new", "contacted", "fulfilled", "cancelled"]);

export type OrderIntentResult =
  | { ok: true; whatsappUrl: string | null }
  | { ok: false; error: string };

/**
 * Called from the public shop the moment a buyer commits. We persist the lead
 * first, then hand back the WhatsApp deep link — so the seller keeps the order
 * even if the buyer never sends the message.
 */
export async function createOrderIntent(input: {
  shopId: string;
  productId: string;
  quantity: number;
  customerName?: string;
  customerContact?: string;
  note?: string;
}): Promise<OrderIntentResult> {
  const db = getDb();

  const shop = await db.query.shops.findFirst({
    where: and(eq(shops.id, input.shopId), eq(shops.isPublished, true)),
  });
  if (!shop) return { ok: false, error: "Shop not found." };

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, input.productId),
      eq(products.shopId, shop.id),
      eq(products.isPublished, true),
    ),
  });
  if (!product) return { ok: false, error: "Product not available." };

  const quantity = Math.min(Math.max(Math.trunc(input.quantity) || 1, 1), 999);
  const name = input.customerName?.trim().slice(0, 120) || null;
  const contact = input.customerContact?.trim().slice(0, 120) || null;
  const note = input.note?.trim().slice(0, 500) || null;

  await db.insert(orders).values({
    shopId: shop.id,
    productId: product.id,
    productTitle: product.title,
    unitPriceCents: product.priceCents,
    quantity,
    currency: shop.currency,
    customerName: name,
    customerContact: contact,
    note,
    channel: shop.whatsapp ? "whatsapp" : "manual",
  });

  revalidatePath("/admin/orders");

  if (!shop.whatsapp) return { ok: true, whatsappUrl: null };

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return {
    ok: true,
    whatsappUrl: buildWhatsAppUrl({
      phone: shop.whatsapp,
      shopName: shop.name,
      productTitle: product.title,
      quantity,
      price: formatMoney(product.priceCents * quantity, shop.currency),
      productUrl: base ? `${base}/${shop.handle}/p/${product.slug}` : undefined,
      note: note ?? undefined,
      customerName: name ?? undefined,
    }),
  };
}

export async function updateOrderStatus(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !STATUSES.has(status)) return;

  await getDb()
    .update(orders)
    .set({ status })
    .where(and(eq(orders.id, id), eq(orders.shopId, shop.id)));

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
}

export async function deleteOrder(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(orders)
    .where(and(eq(orders.id, id), eq(orders.shopId, shop.id)));

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
}
