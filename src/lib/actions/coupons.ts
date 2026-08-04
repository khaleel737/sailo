"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { coupons } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { normalizeCode, percentToBp } from "@/lib/pricing";
import { parseMoneyToCents } from "@/lib/utils";
import type { ActionState } from "./shop";

export async function saveCoupon(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();
  const db = getDb();

  const id = String(formData.get("id") ?? "").trim() || null;
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (code.length < 3) {
    return { ok: false, error: "Code must be at least 3 characters." };
  }

  const discountType =
    String(formData.get("discountType") ?? "percent") === "fixed"
      ? "fixed"
      : "percent";

  const rawValue = String(formData.get("value") ?? "").trim();
  const numeric = Number(rawValue);
  if (!rawValue || !Number.isFinite(numeric) || numeric <= 0) {
    return { ok: false, error: "Enter a discount greater than zero." };
  }
  if (discountType === "percent" && numeric > 100) {
    return { ok: false, error: "A percentage discount can't exceed 100%." };
  }

  const discountValue =
    discountType === "percent" ? percentToBp(numeric) : parseMoneyToCents(rawValue);

  const clash = await db.query.coupons.findFirst({
    where: and(eq(coupons.shopId, shop.id), eq(coupons.code, code)),
    columns: { id: true },
  });
  if (clash && clash.id !== id) {
    return { ok: false, error: "You already have a coupon with that code." };
  }

  const maxRaw = String(formData.get("maxRedemptions") ?? "").trim();
  const maxRedemptions = maxRaw ? Math.max(1, Math.trunc(Number(maxRaw))) : null;

  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return { ok: false, error: "That expiry date isn't valid." };
  }

  const values = {
    code,
    discountType,
    discountValue,
    minSubtotalCents: parseMoneyToCents(String(formData.get("minSubtotal") ?? "0")),
    maxRedemptions:
      maxRedemptions && Number.isFinite(maxRedemptions) ? maxRedemptions : null,
    expiresAt,
    isActive: formData.get("isActive") === "on",
    updatedAt: new Date(),
  };

  if (id) {
    const owned = await db.query.coupons.findFirst({
      where: and(eq(coupons.id, id), eq(coupons.shopId, shop.id)),
      columns: { id: true },
    });
    if (!owned) return { ok: false, error: "Coupon not found." };
    await db.update(coupons).set(values).where(eq(coupons.id, id));
  } else {
    await db.insert(coupons).values({ ...values, shopId: shop.id });
  }

  revalidatePath("/admin/coupons");
  return { ok: true, message: id ? "Coupon updated." : "Coupon created." };
}

export async function deleteCoupon(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(coupons)
    .where(and(eq(coupons.id, id), eq(coupons.shopId, shop.id)));

  revalidatePath("/admin/coupons");
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
}
