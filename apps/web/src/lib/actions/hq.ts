"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shops, staffActions, supportTickets, type Shop } from "@/db/schema";
import { publishShopEvent } from "@/lib/events";
import { maybeRow } from "@/lib/invariant";
import { requireStaff } from "@/lib/session";
import { updateShopNow } from "@/lib/cache";
import { isPlanId, PLANS } from "@/lib/plans";
import type { ActionState } from "./shop";

/* ===========================================================================
   The three things staff may do to someone else's account.

   Everything else in /hq is read-only, and that is the intended balance: this
   panel exists to understand the business, not to operate sellers' shops for
   them. What is here is what support genuinely needs — grant a plan, take an
   abusive shop down, leave a note for the other founder — and every one of
   them writes a row to `staff_actions` before it returns.
=========================================================================== */

async function loadShop(formData: FormData) {
  const staff = await requireStaff();

  const shopId = String(formData.get("shopId") ?? "").trim();
  if (!shopId) return { staff, shop: null } as const;

  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.id, shopId),
  });
  return { staff, shop: shop ?? null } as const;
}

async function record(
  actorEmail: string,
  action: string,
  shop: Shop,
  summary: string,
) {
  await getDb().insert(staffActions).values({
    actorEmail,
    action,
    shopId: shop.id,
    summary,
  });

  /*
   * Entitlements and visibility both change what the public storefront
   * renders, and the storefront is cached until a write says otherwise. Busting
   * the tag here rather than in each caller means no staff action can ship a
   * change that only takes effect the next time the seller happens to edit
   * something.
   *
   * `updateShopNow` rather than the seller-side `revalidateShop`: a staff
   * action is enforcement, and enforcement that lets one more request through
   * isn't enforcement.
   */
  updateShopNow(shop.id, shop.handle);
  revalidatePath(`/hq/accounts/${shop.userId}`);
  revalidatePath("/hq/accounts");
  revalidatePath("/hq/revenue");
  revalidatePath("/hq");

  /*
   * Enforcement lands on the seller's screen as it lands on their account: a
   * suspension banner, a granted plan, a staff note. The seller's panel is
   * the audience the paths above can't reach, being another user's session.
   */
  after(() => publishShopEvent(shop.id, "account"));
}

/**
 * Grants a plan we aren't charging for, or takes one back.
 *
 * Written to `compPlan`, never to `plan` — see the column's note. The seller
 * sees the features; they don't see a bill, because there isn't one.
 */
export async function setCompPlan(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, shop } = await loadShop(formData);
  if (!shop) return { ok: false, error: "That account no longer exists." };

  const requested = String(formData.get("plan") ?? "none").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  if (requested === "none") {
    if (!shop.compPlan) {
      return { ok: false, error: "This account isn't comped." };
    }
    const previous = shop.compPlan;
    await getDb()
      .update(shops)
      .set({ compPlan: null, compNote: null, updatedAt: new Date() })
      .where(eq(shops.id, shop.id));

    await record(
      staff.email,
      "clear_comp",
      shop,
      `Removed the comped ${previous} plan — back to whatever Stripe says.`,
    );
    return { ok: true, message: "Comp removed." };
  }

  if (!isPlanId(requested) || requested === "free") {
    return { ok: false, error: "Pick a paid plan, or None to remove the comp." };
  }

  await getDb()
    .update(shops)
    .set({ compPlan: requested, compNote: note || null, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  await record(
    staff.email,
    "comp_plan",
    shop,
    `Comped ${PLANS[requested].name}${note ? ` — ${note}` : ""}.`,
  );
  return { ok: true, message: `${PLANS[requested].name} granted.` };
}

/**
 * Takes a shop off the air, or puts it back.
 *
 * Separate from the seller's own publish switch: they can turn that one back
 * on, and someone we suspended for fraud absolutely would.
 */
export async function setSuspended(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, shop } = await loadShop(formData);
  if (!shop) return { ok: false, error: "That account no longer exists." };

  const suspend = String(formData.get("suspend") ?? "") === "1";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  if (suspend) {
    if (!reason) {
      return {
        ok: false,
        error: "Say why. Whoever reads this in six months won't remember.",
      };
    }
    await getDb()
      .update(shops)
      .set({
        suspendedAt: new Date(),
        suspendedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(shops.id, shop.id));

    await record(staff.email, "suspend", shop, `Suspended — ${reason}`);
    return { ok: true, message: "Shop suspended. It is offline now." };
  }

  await getDb()
    .update(shops)
    .set({ suspendedAt: null, suspendedReason: null, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  await record(staff.email, "unsuspend", shop, "Suspension lifted.");
  return { ok: true, message: "Shop is back online." };
}

/** An internal note on the account. Never rendered anywhere a seller can see. */
export async function saveStaffNote(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, shop } = await loadShop(formData);
  if (!shop) return { ok: false, error: "That account no longer exists." };

  const note = String(formData.get("note") ?? "").trim().slice(0, 2000);

  await getDb()
    .update(shops)
    .set({ staffNote: note || null, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  await record(
    staff.email,
    "note",
    shop,
    note ? `Note: ${note.slice(0, 120)}` : "Cleared the note.",
  );
  return { ok: true, message: "Saved." };
}

/**
 * Marks a support ticket answered. The conversation itself lives in email —
 * this is the queue's bookkeeping, so the list shows what still needs a reply.
 */
export async function closeSupportTicket(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const db = getDb();
  // Guarded on status, so two staff closing the same ticket audit it once.
  const closed = maybeRow(
    await db
      .update(supportTickets)
      .set({ status: "closed", closedAt: new Date() })
      .where(and(eq(supportTickets.id, id), eq(supportTickets.status, "open")))
      .returning(),
  );
  if (!closed) return;

  /*
   * The audit row directly rather than through `record()`: closing a ticket
   * is desk housekeeping, and `record` also busts the shop's storefront
   * cache — enforcement plumbing a ticket doesn't touch.
   */
  await db.insert(staffActions).values({
    actorEmail: staff.email,
    action: "support_close",
    shopId: closed.shopId,
    summary: `Closed support ticket "${closed.subject.slice(0, 120)}".`,
  });

  revalidatePath("/hq/support");
  // The seller's own list shows the status too.
  revalidatePath("/admin/support");
  after(() => publishShopEvent(closed.shopId, "support"));
}
