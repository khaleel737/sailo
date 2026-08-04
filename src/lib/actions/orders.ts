"use server";

import { revalidatePath } from "next/cache";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
  clients,
  orders,
  paymentMethods,
  products,
  shops,
  type PaymentConfig,
} from "@/db/schema";
import { requireShop } from "@/lib/session";
import { formatAddress, formatMoney, normalizePhone } from "@/lib/utils";
import {
  bankDetailLines,
  buildHandoff,
  isConfigured,
  isPaymentMethodType,
  PAYMENT_METHOD_DEFS,
  type Handoff,
} from "@/lib/payments";

const ORDER_STATUSES = new Set(["new", "confirmed", "fulfilled", "cancelled"]);
const PAYMENT_STATUSES = new Set(["unpaid", "pending", "paid"]);

export type OrderAddress = {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

export type OrderIntentInput = {
  shopId: string;
  productId: string;
  quantity: number;
  paymentMethod: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  note?: string;
} & OrderAddress;

export type OrderIntentResult =
  | {
      ok: true;
      orderId: string;
      handoff: Handoff | null;
      /** Populated for bank transfer so the buyer can pay. */
      bankDetails?: { label: string; value: string }[];
      instructions?: string;
      methodName: string;
    }
  | { ok: false; error: string };

function clean(value: string | undefined, max: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Matches an existing client on email or phone, otherwise creates one. Address
 * fields are refreshed on every order so the profile reflects the latest
 * delivery details the buyer gave.
 */
async function upsertClient(
  shopId: string,
  data: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } & Record<string, string | null>,
) {
  const db = getDb();
  if (!data.email && !data.phone) return null;

  const matchers = [];
  if (data.email) matchers.push(eq(clients.email, data.email));
  if (data.phone) matchers.push(eq(clients.phone, data.phone));
  const match = matchers.length === 1 ? matchers[0] : or(...matchers);

  const existing = await db.query.clients.findFirst({
    where: and(eq(clients.shopId, shopId), match),
  });

  const address = {
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    city: data.city,
    region: data.region,
    postalCode: data.postalCode,
    country: data.country,
  };
  // Don't blank out a stored address when this order didn't collect one.
  const addressUpdate = Object.fromEntries(
    Object.entries(address).filter(([, v]) => v !== null),
  );

  if (existing) {
    await db
      .update(clients)
      .set({
        name: data.name ?? existing.name,
        email: data.email ?? existing.email,
        phone: data.phone ?? existing.phone,
        ...addressUpdate,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(clients)
    .values({
      shopId,
      name: data.name ?? "Anonymous",
      email: data.email,
      phone: data.phone,
      ...address,
    })
    .returning({ id: clients.id });
  return created.id;
}

/**
 * Called from the public shop the moment a buyer commits. Persists the lead
 * first, then returns the next step for the rail they chose.
 */
export async function createOrderIntent(
  input: OrderIntentInput,
): Promise<OrderIntentResult> {
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
  if (!product.inStock) return { ok: false, error: "This item is sold out." };

  if (!isPaymentMethodType(input.paymentMethod)) {
    return { ok: false, error: "Pick how you'd like to order." };
  }

  const method = await db.query.paymentMethods.findFirst({
    where: and(
      eq(paymentMethods.shopId, shop.id),
      eq(paymentMethods.type, input.paymentMethod),
      eq(paymentMethods.isEnabled, true),
    ),
  });
  if (!method || !isConfigured(method.type, method.config)) {
    return { ok: false, error: "That option isn't available right now." };
  }

  const def = PAYMENT_METHOD_DEFS[input.paymentMethod];
  const quantity = Math.min(Math.max(Math.trunc(input.quantity) || 1, 1), 999);

  const email = clean(input.customerEmail, 160)?.toLowerCase() ?? null;
  const phoneRaw = clean(input.customerPhone, 40);
  const phone = phoneRaw ? normalizePhone(phoneRaw) || null : null;

  // Manual rails settle later, so we need a way to reach the buyer.
  if (def.kind === "manual" && !email && !phone) {
    return {
      ok: false,
      error: "Add an email or phone number so the seller can reach you.",
    };
  }

  const address = {
    addressLine1: clean(input.addressLine1, 200),
    addressLine2: clean(input.addressLine2, 200),
    city: clean(input.city, 100),
    region: clean(input.region, 100),
    postalCode: clean(input.postalCode, 32),
    country: clean(input.country, 100),
  };

  const name = clean(input.customerName, 120);
  const note = clean(input.note, 500);

  const clientId = await upsertClient(shop.id, {
    name,
    email,
    phone,
    ...address,
  });

  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      productId: product.id,
      clientId,
      productTitle: product.title,
      unitPriceCents: product.priceCents,
      quantity,
      currency: shop.currency,
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      ...address,
      note,
      paymentMethod: method.type,
      // COD is collected on delivery; transfers are owed until confirmed.
      paymentStatus: "unpaid",
    })
    .returning({ id: orders.id });

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const handoff = buildHandoff(method.type, method.config, {
    shopName: shop.name,
    productTitle: product.title,
    quantity,
    priceLabel: formatMoney(product.priceCents * quantity, shop.currency),
    productUrl: base ? `${base}/${shop.handle}/p/${product.slug}` : undefined,
    customerName: name ?? undefined,
    note: note ?? undefined,
    address: formatAddress(address) || undefined,
  });

  const config = method.config as PaymentConfig;
  return {
    ok: true,
    orderId: order.id,
    handoff,
    methodName: def.name,
    bankDetails:
      method.type === "bank_transfer" ? bankDetailLines(config) : undefined,
    instructions: config.instructions?.trim() || undefined,
  };
}

/**
 * Buyer submits the reference for a transfer they've already sent. Moves the
 * order to `pending` for the seller to confirm.
 */
export async function submitPaymentReference(input: {
  orderId: string;
  reference: string;
}): Promise<{ ok: boolean; error?: string }> {
  const reference = input.reference.trim().slice(0, 200);
  if (!reference) return { ok: false, error: "Add the transfer reference." };

  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, input.orderId),
    columns: { id: true, paymentStatus: true },
  });
  if (!order) return { ok: false, error: "Order not found." };
  // Only an unconfirmed order may be updated from the public side.
  if (order.paymentStatus === "paid") {
    return { ok: false, error: "This order is already marked paid." };
  }

  await db
    .update(orders)
    .set({ paymentReference: reference, paymentStatus: "pending", updatedAt: new Date() })
    .where(eq(orders.id, input.orderId));

  revalidatePath("/admin/orders");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Admin                                                                      */
/* -------------------------------------------------------------------------- */

export async function updateOrderStatus(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !ORDER_STATUSES.has(status)) return;

  await getDb()
    .update(orders)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.shopId, shop.id)));

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
}

export async function updatePaymentStatus(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const paymentStatus = String(formData.get("paymentStatus") ?? "");
  if (!id || !PAYMENT_STATUSES.has(paymentStatus)) return;

  await getDb()
    .update(orders)
    .set({ paymentStatus, updatedAt: new Date() })
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

/** Removes clients that no longer have any orders. */
export async function deleteClient(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(clients)
    .where(and(eq(clients.id, id), eq(clients.shopId, shop.id)));

  revalidatePath("/admin/clients");
  revalidatePath("/admin/orders");
}

export async function updateClientNotes(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000);
  if (!id) return;

  await getDb()
    .update(clients)
    .set({ notes: notes || null, updatedAt: new Date() })
    .where(and(eq(clients.id, id), eq(clients.shopId, shop.id)));

  revalidatePath(`/admin/clients/${id}`);
}
