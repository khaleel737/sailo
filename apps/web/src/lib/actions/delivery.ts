"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { revalidateShop } from "@/lib/cache";
import { publishShopEvent } from "@sailo/events";
import { firstRow } from "@sailo/core/invariant";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { deliveryMethods, type DeliveryConfig } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import {
  DELIVERY_METHOD_DEFS,
  isDeliveryConfigured,
  isDeliveryMethodType,
  parseCountries,
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

  const feeCents = parseMoneyToCents(String(formData.get("fee") ?? "0"), shop.currency);
  const freeOverRaw = String(formData.get("freeOver") ?? "").trim();
  const freeOverCents = freeOverRaw ? parseMoneyToCents(freeOverRaw, shop.currency) : null;

  /*
   * Where this rate reaches. Empty is "anywhere", which is why the form sends
   * the *mode* as well as the list: "selected countries" with nothing ticked
   * would otherwise be stored as an empty array and mean the exact opposite of
   * what the seller asked for. So it is refused instead of saved.
   *
   * Collection never carries a zone whatever the form says — a pickup happens
   * at the seller's own address, so filtering it by where the buyer lives
   * would be a rule about the buyer rather than about the delivery.
   *
   * The raw value is capped before it is split: the whole world is 244 codes
   * and under a kilobyte, and this is a string from a request.
   */
  const wantsZone = type === "shipping" && formData.get("zone") === "selected";
  const countries = wantsZone
    ? parseCountries(String(formData.get("countries") ?? "").slice(0, 4000).split(","))
    : [];
  if (wantsZone && countries.length === 0) {
    return {
      ok: false,
      error: "Pick at least one country to ship to, or choose Anywhere.",
    };
  }

  const values = {
    type,
    name,
    feeCents,
    freeOverCents,
    config,
    countries,
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
  after(() => publishShopEvent(shop.id, "catalog"));
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
  after(() => publishShopEvent(shop.id, "catalog"));
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
  after(() => publishShopEvent(shop.id, "catalog"));
}
