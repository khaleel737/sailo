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
import {
  MAX_BANDS,
  saveDelivery,
  toggleDelivery as toggleShared,
} from "@sailo/commerce/delivery/server";
import { moneyToCents, parseMoneyToCents } from "@sailo/core/currency";
import { buildCurrencyPrices } from "@sailo/core/regional";
import { can } from "@sailo/core/plans";
import type { ActionState } from "./shop";

/**
 * The weight table, as the rate form posts it — spec 51.
 *
 * `band_0_upTo` / `band_0_price` and so on, read until the first row with no
 * ceiling. Grams are read with `optionalCount`-style parsing rather than
 * `moneyToCents`, because a weight is a count and not an amount: "1,500" grams
 * is fifteen hundred in every locale, while "1,500" of money is fifteen in half
 * of them.
 *
 * The price *is* money and is parsed against the shop's currency, so a French
 * seller typing `3,50` gets three fifty rather than three hundred and fifty.
 *
 * Nothing is sorted or validated here — `saveDelivery` runs the row through
 * `usableBands`, which is the one place that decides what a band is.
 */
function readWeightBands(formData: FormData, currency: string) {
  const bands = [];
  for (let i = 0; i < MAX_BANDS; i++) {
    const upTo = String(formData.get(`band_${i}_upTo`) ?? "").trim();
    if (!upTo) continue;

    const grams = Number.parseInt(upTo.replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(grams) || grams <= 0) continue;

    bands.push({
      upToGrams: grams,
      priceCents: parseMoneyToCents(
        String(formData.get(`band_${i}_price`) ?? "0"),
        currency,
      ),
    });
  }
  return bands;
}

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
  const { shop } = await requireShop("settings:write");

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
    /*
     * The same fee in each currency the shop quotes — spec 53. Each parsed
     * against its own currency's decimals, and blank drops the currency rather
     * than storing a free postage rate nobody offered.
     *
     * Gated on the plan here as well as in the form: a form is not a gate.
     */
    currencyPrices: buildCurrencyPrices(
      (can(shop, "regionalPricing") ? shop.regionalCurrencies : []).map((code) => ({
        currency: code,
        priceCents: moneyToCents(String(formData.get(`fee_${code}`) ?? ""), code),
        secondaryCents: moneyToCents(
          String(formData.get(`freeOver_${code}`) ?? ""),
          code,
        ),
      })),
    ),
    /*
     * How this rate is priced, and its table — spec 51.
     *
     * Gated on the plan here as well as in the form, like the currency prices
     * above and for the same reason: a form is not a gate. A shop that has
     * downgraded keeps whatever bands it typed — a downgrade never deletes work
     * — but the rate falls back to `flat`, so the fee a buyer is quoted is the
     * one number every plan can charge.
     *
     * One field per row, named for its index and read until a gap. A seller who
     * clears the middle row of three ends the table there rather than silently
     * merging the last row into the gap, which is the behaviour a parallel-array
     * reader would have.
     */
    rateMode:
      can(shop, "weightBands") && formData.get("rateMode") === "by_weight"
        ? "by_weight"
        : "flat",
    weightBands: readWeightBands(formData, shop.currency),
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
  const { shop } = await requireShop("settings:write");
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
  const { shop } = await requireShop("settings:write");
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
