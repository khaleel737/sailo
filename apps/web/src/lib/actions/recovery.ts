"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";

/**
 * The built-in recovery email's switch — spec 32's one seller-facing control.
 *
 * `settings:write`, not `marketing:send`: this configures the shop the way
 * opening hours do, and the email itself is sent by the cron under the
 * consent rules the pass enforces, not by whoever flipped the switch.
 */
export async function setRecoveryEnabled(formData: FormData): Promise<void> {
  const { shop } = await requireShop("settings:write");
  const enabled = String(formData.get("enabled") ?? "") === "on";

  await getDb()
    .update(shops)
    .set({ recoveryEnabled: enabled, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  revalidatePath("/admin/abandoned");
}
