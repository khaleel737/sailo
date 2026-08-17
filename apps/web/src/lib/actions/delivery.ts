"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { revalidateShop } from "@/lib/cache";
import { publishShopEvent } from "@sailo/events";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { deliveryMethods, type DeliveryConfig } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { DELIVERY_METHOD_DEFS, isDeliveryMethodType } from "@sailo/commerce/delivery";
import { saveDelivery, toggleDelivery as toggleShared } from "@sailo/commerce/delivery/server";
import { parseMoneyToCents } from "@sailo/core/currency";
import type { ActionState } from "./shop";

/**
 * Creates or updates one delivery rate. A shop can have any number of them —
 * "Standard", "Express", "Next day" are all rows of type `shipping`.
 *
 * The rules moved to `@sailo/commerce/delivery-settings` when the phone grew a
 * delivery screen; what is left here is the form. The split is on parsing: a
 * fee typed as `12,50` is twelve fifty in French and twelve hundred and fifty
 * in English, and only the surface that read the keyboard knows which.
 */
export async function saveDeliveryMethod(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  const type = String(formData.get("type") ?? "");
  if (!isDeliveryMethodType(type)) {
    return { ok: false, error: "Unknown delivery type." };
  }

  const def = DELIVERY_METHOD_DEFS[type];
  const config: DeliveryConfig = {};
  for (const field of def.fields) {
    const value = String(formData.get(field.key) ?? "").trim();
    if (value) config[field.key] = value;
  }

  const freeOverRaw = String(formData.get("freeOver") ?? "").trim();

  const result = await saveDelivery({
    shopId: shop.id,
    id: String(formData.get("id") ?? "").trim() || null,
    type,
    name: String(formData.get("name") ?? ""),
    feeCents: parseMoneyToCents(String(formData.get("fee") ?? "0"), shop.currency),
    freeOverCents: freeOverRaw ? parseMoneyToCents(freeOverRaw, shop.currency) : null,
    config,
    isEnabled: formData.get("isEnabled") === "on",
    /*
     * The *mode* travels with the list, and that is what makes the refusal
     * possible. An empty `countries` array means "anywhere", so without knowing
     * the seller had chosen "selected countries" there is no way to tell an
     * intentional worldwide rate from a zone they forgot to tick.
     *
     * The raw value is capped before it is split: the whole world is 244 codes
     * and under a kilobyte, and this is a string from a request.
     */
    zone: formData.get("zone") === "selected" ? "selected" : "anywhere",
    countries: String(formData.get("countries") ?? "").slice(0, 4000).split(","),
  });

  if (!result.ok) return { ok: false, error: REFUSALS[result.reason] };

  revalidatePath("/admin/delivery");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
  after(() => publishShopEvent(shop.id, "catalog"));
  return {
    ok: true,
    message: result.created
      ? `${String(formData.get("name") ?? "").trim()} added.`
      : "Option updated.",
  };
}

/** The shared refusals, in this surface's words. */
const REFUSALS: Record<
  Exclude<Awaited<ReturnType<typeof saveDelivery>>, { ok: true }>["reason"],
  string
> = {
  unknown_type: "Unknown delivery type.",
  no_name: "Give this option a name.",
  unconfigured: "Add a pickup address before turning collection on.",
  empty_zone: "Pick at least one country to ship to, or choose Anywhere.",
  not_found: "Delivery option not found.",
};

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

  /*
   * The shared toggle re-checks that an option is configured before switching
   * it on — never switch on something a buyer could not actually use. It
   * distinguishes "no such row" from "refused", which this surface does not
   * act on differently: a form post has nowhere to put the reason, so both
   * return quietly. The phone tells the seller which it was.
   */
  const result = await toggleShared(shop.id, id);
  if (result === null || result === "unconfigured") return;

  revalidatePath("/admin/delivery");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
  after(() => publishShopEvent(shop.id, "catalog"));
}
