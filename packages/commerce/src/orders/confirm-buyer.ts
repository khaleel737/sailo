import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orderItems, orders, type Shop } from "@sailo/db/schema";
import { sendOrderConfirmation } from "@sailo/email/transactional";
import { downloadUrl } from "../orders/downloads";
import type { DigitalDelivery } from "../orders/digital-delivery";

/**
 * Telling the buyer their order landed.
 *
 * Best effort by design: the order row and, on a card sale, the Stripe session
 * both already exist by the time this runs, so a mail provider having a bad
 * afternoon must not fail a checkout that otherwise succeeded. Every failure
 * here is logged and swallowed.
 *
 * The money has *not* necessarily moved. On the card rail this runs once the
 * Checkout Session exists but before the buyer has paid — they may still
 * abandon it — so the copy has to read as "we have your order", not "we have
 * your money". An earlier version of this comment claimed the payment was
 * settled, and the claim was wrong on every rail.
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
  /*
   * The catch is the whole contract, and it used to be missing.
   *
   * Only the mail provider's own `{sent:false}` result was being handled; the
   * two reads and the `confirmationSentAt` write threw straight out into
   * `createOrderIntent`, which has no catch around this call. Since the
   * reorder put this step *after* the Stripe handoff, a transient database
   * error here failed the whole action for an order whose payment had already
   * been set up — the buyer saw an error for an order that existed and was
   * payable, and could not tell which.
   */
  try {
    await sendConfirmation(opts);
  } catch (error) {
    console.error("[sailo] order confirmation failed", error);
  }
}

async function sendConfirmation(opts: {
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
