import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orderItems, orders, type Shop } from "@sailo/db/schema";
import { emitOrderWebhook } from "@sailo/webhooks/emit";
import {
  clientIdForEmail,
  enrolIfMatching,
} from "@sailo/marketing/automations/server";

/**
 * An order became paid: tell the seller's integrations, and start any flow
 * that was waiting for it.
 *
 * A workflow by this package's own test — its whole body is "tell two other
 * systems", and neither of them is what the function is about. It exists
 * because there are **two** places money is confirmed, and they are easy to
 * miss one of: a seller marking a bank transfer paid
 * (`actions/order-admin.ts`) and a card settling in the Stripe webhook
 * (`lib/stripe-webhooks/connect.ts`). Both already called `emitOrderWebhook`
 * separately, which is the "guard at one sink and not its twin" shape this
 * codebase keeps finding — and spec 30's `product.purchased` trigger would
 * have been the third copy of it.
 *
 * So both now call this, and a future third place has one obvious thing to
 * call rather than two things to remember.
 */
export async function announceOrderPaid(input: {
  shop: Shop;
  orderId: string;
}): Promise<void> {
  const { shop, orderId } = input;

  /*
   * The webhook first, and unconditionally. It is the promise with a consumer
   * on the other end; the enrolment below is ours, and a failure in it must
   * not be able to swallow the announcement a seller's integration is waiting
   * for.
   */
  await emitOrderWebhook({ shop, event: "order.paid", orderId });

  /*
   * The order is read here rather than passed in, because the two callers hold
   * different things — one has just written the row and the other is inside a
   * Stripe handler — and a parameter list they each fill differently is a
   * parameter list one of them fills wrongly.
   */
  const order = await getDb().query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true, shopId: true, customerEmail: true, clientId: true },
  });
  if (!order || order.shopId !== shop.id) return;

  /*
   * No address, nothing to enrol. A chat-rail order often has none, and that
   * is not an error — a flow's *email* steps could not reach them anyway.
   * (A WhatsApp step could, and reaching those buyers through a flow is worth
   * building; it needs a run identity that is not an address, which is a
   * larger change than this line.)
   */
  const email = order.customerEmail?.trim().toLowerCase();
  if (!email) return;

  /*
   * Every product on the order, not just the header's. `orders.product_id` is
   * the first line repeated for convenience, and a trigger configured for the
   * third item in a five-line basket has to fire — reading the header would
   * be the header-vs-lines bug, on a path where the symptom is a flow that
   * silently never runs.
   */
  const lines = await getDb()
    .select({ productId: orderItems.productId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const productIds = [
    ...new Set(lines.flatMap((line) => (line.productId ? [line.productId] : []))),
  ];

  await enrolIfMatching({
    shopId: shop.id,
    trigger: "product.purchased",
    subject: {
      email,
      // The order's own client, or the address's if the order has none — a
      // manual order can carry an email with no `clients` row behind it.
      clientId: order.clientId ?? (await clientIdForEmail(shop.id, email)),
    },
    context: { productIds },
  });
}
