"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { revalidateShop } from "@/lib/cache";
import {
  deleteJurisdiction,
  saveJurisdiction,
  setCountrySales,
} from "@sailo/commerce/tax/server";
import type { ActionState } from "@sailo/core/action-state";

/**
 * The jurisdictions tab's writes.
 *
 * Every one of them ends with `revalidateShop`. The storefront's country picker
 * is built inside `getCheckoutOptions`, which is `"use cache"` +
 * `cacheTag(shopTag(id))` — so a country switched off here and not revalidated
 * would keep being offered to buyers until the cache aged out, and the first
 * anyone would notice is `createOrderIntent` refusing an order the shop's own
 * page had just invited.
 *
 * None of this changes what anybody is charged. Under `taxMode = 'stripe'` the
 * registrations on the seller's connected account decide the rate; under
 * `manual` there is one flat rate. What is recorded here is the seller's own
 * record and the countries they will trade with.
 */

/** Basis points from a percentage typed as "20" or "7.5", or null for blank. */
function readRateBp(raw: FormDataEntryValue | null): number | null | "bad" {
  const text = String(raw ?? "").trim();
  /*
   * Blank is not zero. An empty field means "use the shop's flat rate here";
   * a typed 0 means "this place is zero-rated". Collapsing them would silently
   * zero-rate every registration a seller added without touching the field.
   */
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100) return "bad";
  return Math.round(value * 100);
}

export async function saveTaxJurisdiction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("settings:write");

  const rateBp = readRateBp(formData.get("rateBp"));
  if (rateBp === "bad") {
    return { ok: false, error: "Enter a rate between 0 and 100, or leave it blank." };
  }

  const result = await saveJurisdiction(
    shop.id,
    String(formData.get("id") ?? "") || null,
    {
      country: String(formData.get("country") ?? ""),
      region: String(formData.get("region") ?? "") || null,
      registrationNumber: String(formData.get("registrationNumber") ?? "") || null,
      registeredOn: String(formData.get("registeredOn") ?? "") || null,
      expiresOn: String(formData.get("expiresOn") ?? "") || null,
      rateBp,
    },
  );

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "dates"
          ? "The expiry date is before the registration date."
          : result.error === "rate"
            ? "Enter a rate between 0 and 100, or leave it blank."
            : "Pick a country.",
    };
  }

  revalidatePath("/admin/settings/tax");
  return { ok: true, message: "Registration saved." };
}

export async function removeTaxJurisdiction(formData: FormData) {
  const { shop } = await requireShop("settings:write");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await deleteJurisdiction(shop.id, id);
  revalidatePath("/admin/settings/tax");
}

export async function setTaxCountry(formData: FormData) {
  const { shop } = await requireShop("settings:write");
  const country = String(formData.get("country") ?? "");
  if (!country) return;

  await setCountrySales(shop.id, country, formData.get("enabled") === "on");

  revalidatePath("/admin/settings/tax");
  // The picker on every storefront page is built from this.
  revalidateShop(shop.id, shop.handle);
}

export async function updateTaxOptions(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("settings:write");

  /*
   * `taxCategory` is Stripe's own string (`txcd_…`) and inert under `manual`.
   * Stored either way rather than cleared when the mode changes: a seller who
   * tries Stripe Tax, sets a category, and switches back must not lose it — the
   * same reasoning the tax card's hidden `taxRate` input already follows.
   */
  const category = String(formData.get("taxCategory") ?? "").trim();
  if (category && !/^txcd_[0-9a-z]{8,20}$/i.test(category)) {
    return { ok: false, error: "A tax category looks like txcd_10000000." };
  }

  await getDb()
    .update(shops)
    .set({
      taxOssRegistered: formData.get("taxOssRegistered") === "on",
      taxDisableOnThreshold: formData.get("taxDisableOnThreshold") === "on",
      taxDisableImmediateObligation:
        formData.get("taxDisableImmediateObligation") === "on",
      taxCategory: category || null,
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));

  revalidatePath("/admin/settings/tax");
  /*
   * `taxDisableImmediateObligation` is half of the country gate, so the
   * storefront's picker changes with it. Revalidating only on the per-country
   * switch would leave this one silently ineffective on cached pages — the
   * "guard at one sink and not its twin" shape, in its cache-invalidation form.
   */
  revalidateShop(shop.id, shop.handle);
  return { ok: true, message: "Saved." };
}
