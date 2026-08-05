"use server";

import { revalidatePath } from "next/cache";
import { revalidateShop } from "@/lib/cache";
import { firstRow } from "@/lib/invariant";
import { and, eq, sql } from "drizzle-orm";
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

/**
 * Creates or updates one delivery rate. A shop can have any number of them —
 * "Standard", "Express", "Next day" are all rows of type `shipping`.
 */
export async function saveDeliveryMethod(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();
  const db = getDb();

  const id = String(formData.get("id") ?? "").trim() || null;
  const type = String(formData.get("type") ?? "");
  if (!isDeliveryMethodType(type)) {
    return { ok: false, error: "Unknown delivery type." };
  }

  const def = DELIVERY_METHOD_DEFS[type];
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (!name) return { ok: false, error: "Give this option a name." };

  const config: DeliveryConfig = {};
  for (const field of def.fields) {
    const value = String(formData.get(field.key) ?? "").trim();
    if (value) config[field.key] = value.slice(0, 500);
  }

  const isEnabled = formData.get("isEnabled") === "on";
  if (isEnabled && !isDeliveryConfigured(type, config)) {
    return {
      ok: false,
      error: "Add a pickup address before turning collection on.",
    };
  }

  const feeCents = parseMoneyToCents(String(formData.get("fee") ?? "0"));
  const freeOverRaw = String(formData.get("freeOver") ?? "").trim();
  const freeOverCents = freeOverRaw ? parseMoneyToCents(freeOverRaw) : null;

  const values = {
    type,
    name,
    feeCents,
    freeOverCents,
    config,
    isEnabled,
    updatedAt: new Date(),
  };

  if (id) {
    const owned = await db.query.deliveryMethods.findFirst({
      where: and(
        eq(deliveryMethods.id, id),
        eq(deliveryMethods.shopId, shop.id),
      ),
      columns: { id: true },
    });
    if (!owned) return { ok: false, error: "Delivery option not found." };
    await db
      .update(deliveryMethods)
      .set(values)
      .where(eq(deliveryMethods.id, id));
  } else {
    const { max } = firstRow(await db
      .select({
        max: sql<string>`coalesce(max(${deliveryMethods.position}), 0)`,
      })
      .from(deliveryMethods)
      .where(eq(deliveryMethods.shopId, shop.id)), "max aggregate");

    await db.insert(deliveryMethods).values({
      ...values,
      shopId: shop.id,
      position: Number(max) + 1,
    });
  }

  revalidatePath("/admin/delivery");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
  return { ok: true, message: id ? "Option updated." : `${name} added.` };
}

export async function deleteDeliveryMethod(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(deliveryMethods)
    .where(
      and(eq(deliveryMethods.id, id), eq(deliveryMethods.shopId, shop.id)),
    );

  revalidatePath("/admin/delivery");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
}

export async function toggleDeliveryMethod(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const db = getDb();
  const method = await db.query.deliveryMethods.findFirst({
    where: and(eq(deliveryMethods.id, id), eq(deliveryMethods.shopId, shop.id)),
  });
  if (!method) return;
  // Never switch on an option a buyer couldn't actually use.
  if (!method.isEnabled && !isDeliveryConfigured(method.type, method.config))
    return;

  await db
    .update(deliveryMethods)
    .set({ isEnabled: !method.isEnabled, updatedAt: new Date() })
    .where(eq(deliveryMethods.id, id));

  revalidatePath("/admin/delivery");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
}
