"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { publishShopEvent } from "@sailo/events";
import { requireShop } from "@/lib/session";

/** Clears the tray by marking everything up to now as read. */
export async function markAllNotificationsRead() {
  const { shop } = await requireShop();

  await getDb()
    .update(shops)
    .set({
      notificationsReadAt: new Date(),
      // The per-item list only exists to hide things newer than readAt.
      dismissedNotifications: [],
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));

  revalidatePath("/admin", "layout");
  // A tray cleared on the laptop should not keep ringing on the phone.
  after(() => publishShopEvent(shop.id, "account"));
}

export async function dismissNotification(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "").slice(0, 100);
  if (!id) return;

  // Capped so a long-lived shop can't grow this unboundedly.
  const next = [...new Set([id, ...shop.dismissedNotifications])].slice(0, 200);

  await getDb()
    .update(shops)
    .set({ dismissedNotifications: next, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  revalidatePath("/admin", "layout");
  after(() => publishShopEvent(shop.id, "account"));
}
