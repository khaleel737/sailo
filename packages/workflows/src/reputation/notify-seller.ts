import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, user } from "@sailo/db/schema";
import { sendSellerMarketingPaused } from "@sailo/email/shop";
import type { PauseReason } from "@sailo/marketing/broadcasts/server";

/**
 * Tells the seller their marketing was paused, the moment it happened.
 *
 * Without this the seller discovered an automatic pause only when the Send
 * button refused, days later, with a campaign written and an audience
 * waiting — the worst possible moment to learn it. Same shape as the
 * webhook auto-disable notice (`webhooks/disable.ts`): best effort, never
 * throws, because the pause has already landed and a mail provider having a
 * bad afternoon must not turn a landed verdict into a webhook retry loop.
 */
export async function announceMarketingPause(
  shopId: string,
  reason: PauseReason,
): Promise<void> {
  try {
    const db = getDb();
    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, shopId),
    });
    if (!shop) return;

    const to =
      shop.contactEmail ??
      (
        await db.query.user.findFirst({
          where: eq(user.id, shop.userId),
          columns: { email: true },
        })
      )?.email ??
      null;
    if (!to) return;

    const sent = await sendSellerMarketingPaused({ shop, to, reason });
    if (!sent.sent) {
      console.warn(`[sailo] marketing-paused email not sent: ${sent.reason}`);
    }
  } catch (error) {
    console.error("[sailo] marketing-paused email failed", error);
  }
}
