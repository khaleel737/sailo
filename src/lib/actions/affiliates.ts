"use server";

import { revalidatePath } from "next/cache";
import { firstRow } from "@/lib/invariant";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { affiliates, orders, shops } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { generateCode, normalizeCode, percentToBp } from "@/lib/pricing";
import { can, upgradeMessage } from "@/lib/plans";
import type { ActionState } from "./shop";

const STATUSES = new Set(["pending", "active", "disabled"]);

export async function saveAffiliate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();
  const db = getDb();

  if (!can(shop, "affiliates")) {
    return { ok: false, error: upgradeMessage("affiliates", "Affiliates") };
  }

  const id = String(formData.get("id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "Give this affiliate a name." };

  const email =
    String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 160) ||
    null;

  const rawCode = String(formData.get("code") ?? "").trim();
  const code = rawCode ? normalizeCode(rawCode) : generateCode(name);
  if (code.length < 3) {
    return { ok: false, error: "Code must be at least 3 characters." };
  }

  const clash = await db.query.affiliates.findFirst({
    where: and(eq(affiliates.shopId, shop.id), eq(affiliates.code, code)),
    columns: { id: true },
  });
  if (clash && clash.id !== id) {
    return { ok: false, error: "That code is already in use." };
  }

  // Blank means "use the shop default", which is stored as null.
  const rateRaw = String(formData.get("commission") ?? "").trim();
  let commissionBp: number | null = null;
  if (rateRaw) {
    const pct = Number(rateRaw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: "Commission must be between 0 and 100%." };
    }
    commissionBp = percentToBp(pct);
  }

  const status = String(formData.get("status") ?? "active");
  const values = {
    name,
    email,
    code,
    commissionBp,
    status: STATUSES.has(status) ? status : "active",
    payoutNotes:
      String(formData.get("payoutNotes") ?? "").trim().slice(0, 500) || null,
    updatedAt: new Date(),
  };

  if (id) {
    const owned = await db.query.affiliates.findFirst({
      where: and(eq(affiliates.id, id), eq(affiliates.shopId, shop.id)),
      columns: { id: true },
    });
    if (!owned) return { ok: false, error: "Affiliate not found." };
    await db.update(affiliates).set(values).where(eq(affiliates.id, id));
  } else {
    await db.insert(affiliates).values({ ...values, shopId: shop.id });
  }

  revalidatePath("/admin/affiliates");
  return { ok: true, message: id ? "Affiliate updated." : "Affiliate added." };
}

export async function setAffiliateStatus(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !STATUSES.has(status)) return;

  await getDb()
    .update(affiliates)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(affiliates.id, id), eq(affiliates.shopId, shop.id)));

  revalidatePath("/admin/affiliates");
}

export async function deleteAffiliate(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(affiliates)
    .where(and(eq(affiliates.id, id), eq(affiliates.shopId, shop.id)));

  revalidatePath("/admin/affiliates");
}

/** Marks every unpaid commission for one affiliate as settled. */
export async function markCommissionsPaid(formData: FormData) {
  const { shop } = await requireShop();
  const affiliateId = String(formData.get("affiliateId") ?? "");
  if (!affiliateId) return;

  await getDb()
    .update(orders)
    .set({ commissionPaid: true, updatedAt: new Date() })
    .where(
      and(
        eq(orders.shopId, shop.id),
        eq(orders.affiliateId, affiliateId),
        eq(orders.commissionPaid, false),
      ),
    );

  revalidatePath("/admin/affiliates");
}

export async function updateAffiliateSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  const pct = Number(String(formData.get("defaultCommission") ?? "10"));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { ok: false, error: "Default commission must be between 0 and 100%." };
  }

  const enabling = formData.get("affiliatesEnabled") === "on";
  if (enabling && !can(shop, "affiliates")) {
    return { ok: false, error: upgradeMessage("affiliates", "Referral programmes") };
  }

  await getDb()
    .update(shops)
    .set({
      affiliatesEnabled: enabling,
      affiliateDefaultBp: percentToBp(pct),
      affiliatePublicSignup: formData.get("affiliatePublicSignup") === "on",
      affiliateTerms:
        String(formData.get("affiliateTerms") ?? "").trim().slice(0, 2000) ||
        null,
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));

  revalidatePath("/admin/affiliates");
  revalidatePath(`/${shop.handle}`);
  revalidatePath(`/${shop.handle}/affiliate`);
  return { ok: true, message: "Saved." };
}

/* -------------------------------------------------------------------------- */
/*  Public                                                                     */
/* -------------------------------------------------------------------------- */

/** Someone applying from the shop's public affiliate page. */
export async function applyAsAffiliate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = getDb();
  const shopId = String(formData.get("shopId") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!name) return { ok: false, error: "Add your name." };
  if (!email.includes("@")) return { ok: false, error: "Add a valid email." };

  const shop = await db.query.shops.findFirst({
    where: and(eq(shops.id, shopId), eq(shops.isPublished, true)),
  });
  if (!shop || !shop.affiliatesEnabled || !shop.affiliatePublicSignup) {
    return { ok: false, error: "This shop isn't accepting applications." };
  }

  const existing = await db.query.affiliates.findFirst({
    where: and(eq(affiliates.shopId, shop.id), eq(affiliates.email, email)),
  });
  if (existing) {
    return existing.status === "active"
      ? { ok: true, message: `You're already signed up. Your code is ${existing.code}.` }
      : { ok: true, message: "Your application is already being reviewed." };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const created = firstRow(await db
      .insert(affiliates)
      .values({
        shopId: shop.id,
        name,
        email,
        code: generateCode(name),
        // Applications wait for the seller; buyer referrals go live instantly.
        status: "pending",
        source: "signup",
      })
      .onConflictDoNothing({ target: [affiliates.shopId, affiliates.code] })
      .returning(), "created");
    if (created) {
      revalidatePath("/admin/affiliates");
      return {
        ok: true,
        message: "Thanks! We'll email you once you're approved.",
      };
    }
  }

  return { ok: false, error: "Couldn't sign you up just now. Try again." };
}

/** Fire-and-forget click counter for ?ref= landings. */
export async function recordAffiliateClick(shopId: string, code: string) {
  await getDb()
    .update(affiliates)
    .set({ clicks: sql`${affiliates.clicks} + 1` })
    .where(
      and(
        eq(affiliates.shopId, shopId),
        eq(affiliates.code, normalizeCode(code)),
        eq(affiliates.status, "active"),
      ),
    );
}
