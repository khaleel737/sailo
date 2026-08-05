"use server";

import { revalidatePath } from "next/cache";
import { revalidateShop } from "@/lib/cache";
import { firstRow } from "@/lib/invariant";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { paymentMethods, type PaymentConfig } from "@/db/schema";
import { requireShop } from "@/lib/session";
import {
  isConfigured,
  isPaymentMethodType,
  PAYMENT_METHOD_DEFS,
} from "@/lib/payments";
import type { ActionState } from "./shop";

/**
 * Saves one rail's settings. Enabling a rail whose required fields are blank
 * is rejected — a half-configured option that 404s the buyer is worse than a
 * missing one.
 */
export async function savePaymentMethod(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();
  const type = String(formData.get("type") ?? "");

  if (!isPaymentMethodType(type)) {
    return { ok: false, error: "Unknown payment method." };
  }

  const def = PAYMENT_METHOD_DEFS[type];
  const config: PaymentConfig = {};
  for (const field of def.fields) {
    const value = String(formData.get(field.key) ?? "").trim();
    if (value) config[field.key] = value.slice(0, 500);
  }

  const isEnabled = formData.get("isEnabled") === "on";
  if (isEnabled && !isConfigured(type, config)) {
    const missing = def.fields
      .filter((f) => f.required && !config[f.key])
      .map((f) => f.label.toLowerCase())
      .join(" and ");
    return { ok: false, error: `Add your ${missing} before turning this on.` };
  }

  const label = String(formData.get("label") ?? "").trim().slice(0, 60) || null;
  const db = getDb();

  const { max } = firstRow(await db
    .select({ max: sql<string>`coalesce(max(${paymentMethods.position}), 0)` })
    .from(paymentMethods)
    .where(eq(paymentMethods.shopId, shop.id)), "max aggregate");

  await db
    .insert(paymentMethods)
    .values({
      shopId: shop.id,
      type,
      label,
      config,
      isEnabled,
      position: Number(max) + 1,
    })
    .onConflictDoUpdate({
      target: [paymentMethods.shopId, paymentMethods.type],
      set: { label, config, isEnabled, updatedAt: new Date() },
    });

  revalidatePath("/admin/payments");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
  return { ok: true, message: `${def.name} saved.` };
}

export async function togglePaymentMethod(formData: FormData) {
  const { shop } = await requireShop();
  const type = String(formData.get("type") ?? "");
  if (!isPaymentMethodType(type)) return;

  const db = getDb();
  const existing = await db.query.paymentMethods.findFirst({
    where: and(
      eq(paymentMethods.shopId, shop.id),
      eq(paymentMethods.type, type),
    ),
  });
  // Never flip an unconfigured rail on.
  if (!existing) return;
  if (!existing.isEnabled && !isConfigured(type, existing.config)) return;

  await db
    .update(paymentMethods)
    .set({ isEnabled: !existing.isEnabled, updatedAt: new Date() })
    .where(eq(paymentMethods.id, existing.id));

  revalidatePath("/admin/payments");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
}
