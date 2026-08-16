"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { revalidateShop } from "@/lib/cache";
import { publishShopEvent } from "@sailo/events";
import { saveRail } from "@sailo/payments/offline/settings";
import { requireShop } from "@/lib/session";
import { isPaymentMethodType, PAYMENT_METHOD_DEFS } from "@/lib/payments";
import type { PaymentConfig } from "@sailo/db/schema";
import type { ActionState } from "./shop";

/**
 * Saves one rail's settings.
 *
 * The rule this used to hold — a rail may not be enabled while a required field
 * is blank — now lives in `@sailo/payments/offline`, because the phone
 * needs to enforce the same one and cannot call a server action. What is left
 * here is the half that is genuinely Next's: reading a `FormData`, deciding
 * which paths to revalidate, and writing the refusal as a sentence.
 *
 * The sentence is still built here rather than returned by the shared function.
 * `saveRail` answers with the *keys* of the fields that were blank, and this
 * looks their labels up in the definitions — which are English literals, so a
 * shared function that returned a finished sentence would have handed the
 * phone an English one to show inside a Spanish app.
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

  /*
   * Read off the form by the rail's own field list. `saveRail` filters again
   * on the same list — it has to, since the phone builds this object itself —
   * so this is the form parser rather than the guard.
   */
  const config: PaymentConfig = {};
  for (const field of def.fields) {
    const value = String(formData.get(field.key) ?? "").trim();
    if (value) config[field.key] = value;
  }

  const result = await saveRail({
    shopId: shop.id,
    type,
    config,
    isEnabled: formData.get("isEnabled") === "on",
    label: String(formData.get("label") ?? ""),
  });

  if (!result.ok) {
    if (result.reason === "unknown") {
      return { ok: false, error: "Unknown payment method." };
    }
    const missing = result.missing
      .map((key) => def.fields.find((f) => f.key === key)?.label.toLowerCase() ?? key)
      .join(" and ");
    return { ok: false, error: `Add your ${missing} before turning this on.` };
  }

  revalidatePath("/admin/payments");
  revalidatePath(`/${shop.handle}`);
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
  after(() => publishShopEvent(shop.id, "account"));
  return { ok: true, message: `${def.name} saved.` };
}
