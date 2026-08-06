import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orderItems, orders, type Shop } from "@/db/schema";
import { sendOrderConfirmation } from "@/lib/email";
import { downloadUrl } from "@/lib/downloads";
import type { DigitalDelivery } from "@/lib/orders/digital-delivery";

/**
 * Telling the buyer their order landed.
 *
 * Best effort by design, and the design is the point: the money has already
 * moved by the time this runs, so a mail provider having a bad afternoon must
 * not fail an order that succeeded. Every failure here is logged and swallowed.
 *
 * `confirmationSentAt` is written only when the send actually succeeded, so a
 * seller looking at an order can tell "we emailed them" from "we tried".
 */
export async function confirmBuyerByEmail(opts: {
  shop: Shop;
  orderId: string;
  invoice: { token: string; number: string } | null | undefined;
  delivery: Pick<DigitalDelivery, "deliversFiles" | "unlockNow" | "downloadToken">;
  base: string;
}): Promise<void> {
  const db = getDb();

  /*
   * Read back rather than reuse the values that built the insert.
   *
   * The row is what the buyer is being told about, and by this point the card
   * handoff has already written the Stripe session onto it. Composing the
   * email from the in-memory draft would describe an order that never quite
   * existed.
   */
  const saved = await db.query.orders.findFirst({
    where: eq(orders.id, opts.orderId),
  });
  if (!saved) return;

  const { deliversFiles, unlockNow, downloadToken } = opts.delivery;
  const result = await sendOrderConfirmation({
    shop: opts.shop,
    order: saved,
    items: await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, opts.orderId),
      orderBy: [asc(orderItems.position)],
    }),
    invoiceUrl:
      opts.invoice && opts.base
        ? `${opts.base}/invoice/${opts.invoice.token}`
        : null,
    invoiceNumber: opts.invoice?.number ?? null,
    downloadUrl:
      unlockNow && downloadToken ? downloadUrl(downloadToken, opts.base) : null,
    // Files exist but are held until the money clears; the email says so
    // rather than going out with no mention of what they bought.
    downloadPending: deliversFiles && !unlockNow,
  });

  if (!result.sent) {
    console.warn(`[sailo] order email not sent: ${result.reason}`);
    return;
  }

  await db
    .update(orders)
    .set({ confirmationSentAt: new Date() })
    .where(eq(orders.id, opts.orderId));
}
