"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { coupons } from "@sailo/db/schema";
import { publishShopEvent } from "@sailo/events";
import { requireShop } from "@/lib/session";
/* Aliased because this file exports a `saveCoupon` of its own — the action that
   wraps it. The two are deliberately the same name: one is the form, one is the
   rule, and a reader following the call arrives where the rule actually is. */
import { saveCoupon as save } from "@sailo/commerce/coupons";
import { moneyToCents, parseMoneyToCents } from "@sailo/core/currency";
import { buildCurrencyPrices } from "@sailo/core/regional";
import { can, upgradeMessage } from "@sailo/core/plans";
import type { ActionState } from "./shop";

/**
 * The rules moved to `@sailo/commerce/coupons` when the phone grew a coupons
 * screen; what is left here is the form.
 *
 * The split is on parsing. A seller typing `12,50` means twelve fifty in French
 * and one thousand two hundred and fifty in English, and only the surface that
 * read the keyboard knows which — so this turns strings into numbers, and the
 * shared function takes numbers and owns every decision about what they may be.
 * The percentage ceiling in particular: a `percent` coupon above 100% is a
 * negative order total, and nothing downstream refuses one.
 */
export async function saveCoupon(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  if (!can(shop, "coupons")) {
    return { ok: false, error: upgradeMessage("coupons", "Discount codes") };
  }

  const discountType =
    String(formData.get("discountType") ?? "percent") === "fixed" ? "fixed" : "percent";

  const rawValue = String(formData.get("value") ?? "").trim();
  if (!rawValue || !Number.isFinite(Number(rawValue))) {
    return { ok: false, error: "Enter a discount greater than zero." };
  }

  /*
   * A percentage stays a plain number and a fixed amount becomes minor units.
   * `saveCoupon` converts the percentage to basis points itself — one column
   * holds both units, and doing that conversion in two places is how they come
   * to disagree.
   */
  const value =
    discountType === "percent" ? Number(rawValue) : parseMoneyToCents(rawValue, shop.currency);

  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return { ok: false, error: "That expiry date isn't valid." };
  }

  const maxRaw = String(formData.get("maxRedemptions") ?? "").trim();
  const maxRedemptions = maxRaw && Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : null;

  const id = String(formData.get("id") ?? "").trim() || null;

  const result = await save({
    shopId: shop.id,
    id,
    code: String(formData.get("code") ?? ""),
    discountType,
    value,
    minSubtotalCents: parseMoneyToCents(
      String(formData.get("minSubtotal") ?? "0"),
      shop.currency,
    ),
    /*
     * The same two amounts in each currency the shop quotes — spec 53.
     *
     * A **percentage** coupon needs no entry unless it names a minimum: 10%
     * off is 10% off in any currency, and `couponAtCurrency` lets it through.
     * A fixed one always does, because a `€5` code that takes five off
     * whatever the buyer happens to be paying in is a discount nobody set.
     */
    currencyPrices: buildCurrencyPrices(
      (can(shop, "regionalPricing") ? shop.regionalCurrencies : []).map((code) => ({
        currency: code,
        priceCents:
          discountType === "percent"
            ? /* A percentage has no amount to price; the entry exists only to
                 carry the minimum, so it is stored as a zero discount rather
                 than dropped — dropping it would take the minimum with it. */
              (moneyToCents(String(formData.get(`minSubtotal_${code}`) ?? ""), code) ===
              null
                ? null
                : 0)
            : moneyToCents(String(formData.get(`value_${code}`) ?? ""), code),
        secondaryCents: moneyToCents(
          String(formData.get(`minSubtotal_${code}`) ?? ""),
          code,
        ),
      })),
    ),
    maxRedemptions,
    expiresAt,
    isActive: formData.get("isActive") === "on",
  });

  if (!result.ok) return { ok: false, error: REFUSALS[result.reason] };

  revalidatePath("/admin/coupons");
  after(() => publishShopEvent(shop.id, "catalog"));
  return { ok: true, message: result.created ? "Coupon created." : "Coupon updated." };
}

/**
 * The shared refusals, in this surface's words.
 *
 * `saveCoupon` answers with a reason rather than a sentence, because the phone
 * renders the same refusal in thirty-five languages and a shared function that
 * returned English would have made that impossible.
 */
const REFUSALS: Record<
  Exclude<Awaited<ReturnType<typeof save>>, { ok: true }>["reason"],
  string
> = {
  code_too_short: "Code must be at least 3 characters.",
  value_not_positive: "Enter a discount greater than zero.",
  percent_too_high: "A percentage discount can't exceed 100%.",
  code_taken: "You already have a coupon with that code.",
  not_found: "Coupon not found.",
};

export async function deleteCoupon(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(coupons)
    .where(and(eq(coupons.id, id), eq(coupons.shopId, shop.id)));

  revalidatePath("/admin/coupons");
  after(() => publishShopEvent(shop.id, "catalog"));
}

export async function toggleCoupon(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const db = getDb();
  const coupon = await db.query.coupons.findFirst({
    where: and(eq(coupons.id, id), eq(coupons.shopId, shop.id)),
  });
  if (!coupon) return;

  await db
    .update(coupons)
    .set({ isActive: !coupon.isActive, updatedAt: new Date() })
    .where(eq(coupons.id, id));

  revalidatePath("/admin/coupons");
  after(() => publishShopEvent(shop.id, "catalog"));
}
