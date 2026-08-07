"use server";

import { revalidatePath } from "next/cache";
import { revalidateShop } from "@/lib/cache";
import { maybeRow } from "@/lib/invariant";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { affiliates, orders, shops, type Affiliate, type Shop } from "@/db/schema";
import { ensurePortalToken, portalUrl } from "@/lib/affiliate-portal";
import { appUrl } from "@/lib/app-url";
import { sendAffiliateWelcome } from "@/lib/email";
import { requireShop } from "@/lib/session";
import { bufferAffiliateClick, rateLimit } from "@/lib/redis";
import { callerIp } from "@/lib/client-ip";
import { formatPercent, generateCode, normalizeCode, percentToBp } from "@/lib/pricing";
import { can, upgradeMessage } from "@/lib/plans";
import type { ActionState } from "./shop";

const STATUSES = new Set(["pending", "active", "disabled"]);

/**
 * Tells a newly active affiliate where everything is: their share link and
 * their report. Without this the only copy of the portal link sits in the
 * seller's admin, waiting to be pasted into a chat that may never happen.
 * Best effort — the status change stands whether or not the mail goes out.
 */
async function welcomeAffiliate(shop: Shop, affiliate: Affiliate) {
  if (!affiliate.email) return;
  const base = appUrl();

  const result = await sendAffiliateWelcome({
    to: affiliate.email,
    shopName: shop.name,
    percent: formatPercent(affiliate.commissionBp ?? shop.affiliateDefaultBp),
    shareUrl: `${base}/${shop.handle}?ref=${affiliate.code}`,
    portalUrl: portalUrl(await ensurePortalToken(affiliate), base),
  });
  if (!result.sent) {
    console.warn(`[sailo] affiliate welcome not sent: ${result.reason}`);
  }
}

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
      columns: { id: true, status: true },
    });
    if (!owned) return { ok: false, error: "Affiliate not found." };
    const updated = maybeRow(
      await db
        .update(affiliates)
        .set(values)
        .where(eq(affiliates.id, id))
        .returning(),
    );
    // Flipping the status dropdown to active is an approval too, not just the
    // Approve button — the applicant is owed the same welcome either way.
    if (updated && owned.status === "pending" && updated.status === "active") {
      await welcomeAffiliate(shop, updated);
    }
  } else {
    const created = maybeRow(
      await db
        .insert(affiliates)
        .values({ ...values, shopId: shop.id })
        .returning(),
    );
    if (created && created.status === "active") {
      await welcomeAffiliate(shop, created);
    }
  }

  revalidatePath("/admin/affiliates");
  return { ok: true, message: id ? "Affiliate updated." : "Affiliate added." };
}

export async function setAffiliateStatus(formData: FormData) {
  const { shop } = await requireShop();
  const db = getDb();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !STATUSES.has(status)) return;

  const previous = await db.query.affiliates.findFirst({
    where: and(eq(affiliates.id, id), eq(affiliates.shopId, shop.id)),
    columns: { status: true },
  });
  if (!previous) return;

  const updated = maybeRow(
    await db
      .update(affiliates)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(affiliates.id, id), eq(affiliates.shopId, shop.id)))
      .returning(),
  );

  // Approval is the moment the affiliate learns they're in and where their
  // report lives. Re-enabling a disabled one is seller housekeeping — no mail.
  if (updated && previous.status === "pending" && status === "active") {
    await welcomeAffiliate(shop, updated);
  }

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
  // The catalogue is cached per shop; a write has to drop it.
  revalidateShop(shop.id, shop.handle);
  revalidatePath(`/${shop.handle}/affiliate`);
  return { ok: true, message: "Saved." };
}

/* -------------------------------------------------------------------------- */
/*  Public                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The one answer this action ever gives.
 *
 * It used to branch three ways — "your code is X" for an active affiliate,
 * "already being reviewed" for a pending one, "thanks" for a new one — which
 * made an unauthenticated form into a way to ask whether a given person
 * promotes a given shop, and then to read their code back. `requestPortalLink`
 * in `partner.ts` answers identically for exactly this reason; this is the
 * same property, applied to the endpoint that was giving it away.
 *
 * The reply is deliberately vague about what happened: it is true whether the
 * application was created, already existed, or was refused.
 */
const APPLICATION_RECEIVED = {
  ok: true,
  message: "Thanks! We'll email you once you're approved.",
} as const;

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

  /*
   * The only public write in the repo that had no ceiling. Unlimited inserts
   * into `affiliates` against any shop that takes applications, and — before
   * the constant reply below — an unlimited oracle to go with them.
   *
   * Keyed by IP and by shop, so one prolific applicant cannot lock a shop's
   * form for everyone else.
   */
  const gate = await rateLimit(`affiliate-apply:${await callerIp()}`, 5, 900);
  if (!gate.allowed) return APPLICATION_RECEIVED;

  const shop = await db.query.shops.findFirst({
    where: and(eq(shops.id, shopId), eq(shops.isPublished, true), isNull(shops.suspendedAt)),
  });
  /*
   * `can(shop, "affiliates")` as well as the two toggles: the public page at
   * `/[handle]/affiliate` already refuses to render without the plan, and an
   * action that takes whatever the client sends must check what its own page
   * checks rather than trust that the visitor came through it.
   */
  if (
    !shop ||
    !shop.affiliatesEnabled ||
    !shop.affiliatePublicSignup ||
    !can(shop, "affiliates")
  ) {
    return { ok: false, error: "This shop isn't accepting applications." };
  }

  const existing = await db.query.affiliates.findFirst({
    where: and(eq(affiliates.shopId, shop.id), eq(affiliates.email, email)),
  });
  // Never says which of the two this is, and never repeats the code back.
  if (existing) return APPLICATION_RECEIVED;

  for (let attempt = 0; attempt < 5; attempt++) {
    // No row means the generated code collided, which is what the retry is
    // for. `firstRow` threw on it instead, so the `if` below never ran.
    const created = maybeRow(await db
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
      .returning());
    if (created) {
      revalidatePath("/admin/affiliates");
      return APPLICATION_RECEIVED;
    }
  }

  return { ok: false, error: "Couldn't sign you up just now. Try again." };
}

/**
 * Fire-and-forget click counter for ?ref= landings.
 *
 * The `60/60` ceiling used to live only on `/api/referral`, which calls this —
 * but an exported async function in a `"use server"` module is a server action
 * in its own right, with its own id in the build manifest and its own POST
 * endpoint. A server action runs *before* the page renders, so no page guard
 * stands in front of it either. The limit belongs here, where the write is.
 */
export async function recordAffiliateClick(shopId: string, code: string) {
  const gate = await rateLimit(`ref:${await callerIp()}`, 60, 60);
  if (!gate.allowed) return;

  const db = getDb();

  /*
   * A click is the one public write that scales with traffic rather than with
   * orders — a popular affiliate posting a link turns into a row UPDATE per
   * visitor. When Redis is there the count is buffered and folded in nightly;
   * when it isn't, this does exactly what it always did.
   *
   * Buffering needs the affiliate's id, so the row is still read — but a
   * SELECT on an indexed unique key is far cheaper than an UPDATE, and it
   * doesn't take a row lock every affiliate click contends for.
   */
  const affiliate = await db.query.affiliates.findFirst({
    where: and(
      eq(affiliates.shopId, shopId),
      eq(affiliates.code, normalizeCode(code)),
      eq(affiliates.status, "active"),
    ),
    columns: { id: true },
  });
  if (!affiliate) return;

  if (await bufferAffiliateClick(affiliate.id)) return;

  await db
    .update(affiliates)
    .set({ clicks: sql`${affiliates.clicks} + 1` })
    .where(eq(affiliates.id, affiliate.id));
}
