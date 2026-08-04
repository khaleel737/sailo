"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { deliveryMethods, type DeliveryConfig } from "@/db/schema";
import { requireShop } from "@/lib/session";
import {
  DELIVERY_METHOD_DEFS,
  isDeliveryConfigured,
  isDeliveryMethodType,
} from "@/lib/delivery";
import { parseMoneyToCents } from "@/lib/utils";
import type { ActionState } from "./shop";

export async function saveDeliveryMethod(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();
  const type = String(formData.get("type") ?? "");

  if (!isDeliveryMethodType(type)) {
    return { ok: false, error: "Unknown delivery method." };
  }

  const def = DELIVERY_METHOD_DEFS[type];
  const config: DeliveryConfig = {};
  for (const field of def.fields) {
    const value = String(formData.get(field.key) ?? "").trim();
    if (value) config[field.key] = value.slice(0, 500);
  }

  const isEnabled = formData.get("isEnabled") === "on";
  if (isEnabled && !isDeliveryConfigured(type, config)) {
    return {
      ok: false,
      error: "Add your pickup address before turning collection on.",
    };
  }

  const feeCents = parseMoneyToCents(String(formData.get("fee") ?? "0"));
  const freeOverRaw = String(formData.get("freeOver") ?? "").trim();
  const freeOverCents = freeOverRaw ? parseMoneyToCents(freeOverRaw) : null;

  const db = getDb();
  const [{ max }] = await db
    .select({ max: sql<string>`coalesce(max(${deliveryMethods.position}), 0)` })
    .from(deliveryMethods)
    .where(eq(deliveryMethods.shopId, shop.id));

  const label = String(formData.get("label") ?? "").trim().slice(0, 60) || null;

  await db
    .insert(deliveryMethods)
    .values({
      shopId: shop.id,
      type,
      label,
      feeCents,
      freeOverCents,
      config,
      isEnabled,
      position: Number(max) + 1,
    })
    .onConflictDoUpdate({
      target: [deliveryMethods.shopId, deliveryMethods.type],
      set: {
        label,
        feeCents,
        freeOverCents,
        config,
        isEnabled,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/admin/delivery");
  revalidatePath(`/${shop.handle}`);
  return { ok: true, message: `${def.name} saved.` };
}
