"use server";

/**
 * The written record: staff notes, and closing a support ticket.
 *
 * Every other HQ action writes a note as a side effect; these two are the note.
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, staffActions, supportTickets } from "@sailo/db/schema";
import { publishShopEvent } from "@sailo/events";
import { maybeRow } from "@sailo/core/invariant";
import { requireStaff } from "@/lib/session";
import type { ActionState } from "@sailo/core/action-state";
import { loadShop, record } from "./shared";


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

  revalidatePath("/support");
  // The seller's own list shows the status too.
  revalidatePath("/admin/support");
  after(() => publishShopEvent(closed.shopId, "support"));
}
