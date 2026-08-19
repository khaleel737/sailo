import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orderItems, orders, type Shop } from "@sailo/db/schema";
import { sendOrderConfirmation } from "@sailo/email/transactional";
import { downloadUrl } from "@sailo/commerce/orders/server";
import type { DigitalDelivery } from "@sailo/commerce/orders/server";
import { logOrderMessage } from "@sailo/commerce/disputes";

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
 * `confirmationSentAt` survives a failed send as null, so a seller looking at an
 * order can tell "we emailed them" from "we tried" — and so a retry is still
 * possible. It is *claimed* before the send rather than stamped after it; see
 * `sendConfirmation`.
 */
export async function confirmBuyerByEmail(opts: {
  shop: Shop;
  orderId: string;
  invoice: { token: string; number: string } | null | undefined;
  delivery: Pick<
    DigitalDelivery,
    "deliversFiles" | "deliversAccess" | "unlockNow" | "downloadToken"
  >;
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
    /*
     * Give the claim back on the way out, for the same reason the `!sent` branch
     * does. A throw from the mail provider that left the claim held would mean
     * the buyer has no receipt and nothing will ever try again — a silent
     * failure strictly worse than the double-send this claim exists to stop.
     *
     * Its own try: the release is a database write and the thing being handled
     * may well be the database being unreachable. A throw here would escape the
     * catch that is the whole contract of this function.
     */
    try {
      await releaseClaim(opts.orderId);
    } catch (releaseError) {
      console.error("[sailo] order confirmation claim not released", releaseError);
    }
  }
}

async function sendConfirmation(opts: {
  shop: Shop;
  orderId: string;
  invoice: { token: string; number: string } | null | undefined;
  delivery: Pick<
    DigitalDelivery,
    "deliversFiles" | "deliversAccess" | "unlockNow" | "downloadToken"
  >;
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

  /*
   * Claim the send before making it, with the ceiling in the WHERE.
   *
   * Both callers guard with a read — `if (!order.confirmationSentAt)` — and a
   * read is not a claim. Stripe delivers settling events for one order under
   * more than one type and therefore more than one id, so the route's event-id
   * claim does not fence them: `checkout.session.completed` and
   * `checkout.session.async_payment_succeeded` for the same session both find
   * `confirmationSentAt` null and both send. The buyer gets two receipts for one
   * order, with two invoice links, which is the shape of bug that makes people
   * doubt whether they were charged twice.
   *
   * Conditional, so exactly one caller wins it. Released below if the send did
   * not happen, so a mail outage is still retryable — the property the old
   * stamp-afterwards order was protecting, kept.
   */
  const [claimed] = await db
    .update(orders)
    .set({ confirmationSentAt: new Date() })
    .where(and(eq(orders.id, opts.orderId), isNull(orders.confirmationSentAt)))
    .returning({ id: orders.id });
  if (!claimed) return;

  const { deliversFiles, deliversAccess, unlockNow, downloadToken } = opts.delivery;
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
    /*
     * Something exists but is held until the money clears; the email says so
     * rather than going out with no mention of what they bought.
     *
     * A licence key and a Notion invite are held by the same timestamp and are
     * as much the good as a PDF is — spec 48 — so the copy has to cover them
     * too. Reading `deliversFiles` alone here was the guard-at-one-sink shape:
     * the token was minted, the page was gated, and the email was the one
     * place that still believed only files were being waited for.
     */
    /*
     * `Boolean(...)`, because this reaches a JSON boundary. A caller that omits
     * `deliversAccess` — an older Stripe webhook payload, a hand-built object —
     * would otherwise put `undefined` into the email's props, where a template
     * reading it as "not pending" and a template reading it as falsy-but-set
     * are two different renderings of the same order.
     */
    downloadPending: Boolean(deliversFiles || deliversAccess) && !unlockNow,
  });

  if (!result.sent) {
    console.warn(`[sailo] order email not sent: ${result.reason}`);
    await releaseClaim(opts.orderId);
    return;
  }

  /*
   * Keep it, because a chargeback is answered with it.
   *
   * Stripe's `customer_communication` evidence slot asks for the messages sent
   * to the buyer, and `FILE_ASKS` was asking the *seller* to upload the ones
   * Sailo had itself sent and thrown away. Spec 44.
   *
   * **After the send, and only on success.** A logged message that never went is
   * worse than no log: it is a false claim to a bank, made on the seller's
   * behalf. That is the same rule the claim above follows and the same rule the
   * whole evidence pipeline is written around — never state a fact Sailo does
   * not hold.
   *
   * `logOrderMessage` swallows its own failures and redacts the download token
   * out of the body on the way in, so this cannot fail a settled order and
   * cannot leave a live bearer token in a row that staff read and an evidence
   * pack prints.
   */
  await logOrderMessage({
    orderId: opts.orderId,
    shopId: opts.shop.id,
    kind: "confirmation",
    toAddress: saved.customerEmail,
    subject: result.subject,
    bodyText: result.text,
    providerMessageId: result.id,
    status: "sent",
  });
}

/**
 * Give the claim back, so a send that did not happen can be tried again.
 *
 * Deliberately unconditional on the timestamp: only the caller that won the
 * claim ever reaches this, and it is releasing its own.
 */
async function releaseClaim(orderId: string): Promise<void> {
  await getDb()
    .update(orders)
    .set({ confirmationSentAt: null })
    .where(eq(orders.id, orderId));
}
