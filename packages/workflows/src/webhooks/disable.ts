/**
 * Giving up on an endpoint, once, and telling the seller why.
 */

import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, user, webhookEndpoints } from "@sailo/db/schema";
import { maybeRow } from "@sailo/core/invariant";
import { sendSellerWebhookDisabled } from "@sailo/email/shop";
import { AUTO_DISABLE_AFTER } from "./policy";

export /**
 * Switches an endpoint off and tells the seller why.
 *
 * The UPDATE is conditional on it still being active, so the several failures
 * that can land in one tick disable it once and send one email rather than one
 * of each per failure.
 */
async function disableEndpoint(opts: {
  endpointId: string;
  shopId: string;
  url: string;
  label: string | null;
  reason: string;
  now: Date;
}): Promise<boolean> {
  const db = getDb();

  const stopped = maybeRow(
    await db
      .update(webhookEndpoints)
      .set({
        isActive: false,
        disabledReason: opts.reason.slice(0, 300),
        updatedAt: opts.now,
      })
      .where(
        and(
          eq(webhookEndpoints.id, opts.endpointId),
          eq(webhookEndpoints.isActive, true),
        ),
      )
      .returning({ id: webhookEndpoints.id }),
  );

  if (!stopped) return false;

  console.warn(
    `[sailo] webhook endpoint ${opts.endpointId} disabled after ` +
      `${AUTO_DISABLE_AFTER} consecutive failures: ${opts.reason}`,
  );

  /*
   * Best effort, and deliberately not awaited into anything that could fail
   * the tick. An endpoint that is off with no email is recoverable — the
   * settings card says so in red — and a mail provider having a bad afternoon
   * must not stop the queue draining for every other shop.
   */
  try {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, opts.shopId),
    });
    if (!shop) return true;

    const to =
      shop.contactEmail ??
      (
        await db.query.user.findFirst({
          where: eq(user.id, shop.userId),
          columns: { email: true },
        })
      )?.email ??
      null;
    if (!to) return true;

    const sent = await sendSellerWebhookDisabled({
      shop,
      to,
      url: opts.url,
      label: opts.label,
      reason: opts.reason,
      failures: AUTO_DISABLE_AFTER,
    });
    if (!sent.sent) {
      console.warn(`[sailo] webhook-disabled email not sent: ${sent.reason}`);
    }
  } catch (error) {
    console.error("[sailo] webhook-disabled email failed", error);
  }

  return true;
}
