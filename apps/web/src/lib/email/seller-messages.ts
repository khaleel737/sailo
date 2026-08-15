import "server-only";
import type { Order, Shop } from "@sailo/db/schema";
import { orderSummaryTitle, type OrderLine } from "@/lib/order-lines";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { formatMoney } from "@/lib/utils";
import { appUrl } from "@/lib/app-url";
import { ORDERS, send, sender, type SendResult } from "@sailo/email/transport";
import {
  button,
  detailTable,
  esc,
  fine,
  formatWhen,
  itemRows,
  moneyRows,
  mutedPara,
  para,
  sailoLayout,
  section,
  strong,
  type Detail,
} from "@sailo/email/markup";

/**
 * Every message Sailo sends to a *seller* about their own shop.
 *
 * Kept apart from `messages.ts` the way the admin dictionary is kept apart
 * from the storefront's: buyers and sellers are different audiences. Buyer
 * mail is shop-branded (`layout(shop, …)`) because the buyer bought from the
 * shop; these use `sailoLayout` because they are Sailo telling a seller what
 * happened in their own admin.
 *
 * Same contract as every sender here: a `SendResult`, never a throw — whether
 * anything should be sent at all (prefs, the daily ceiling) is decided by
 * `lib/orders/notify-seller.ts`, not in these builders.
 *
 * Buyer PII stays minimal on purpose: name and what they bought, never the
 * delivery address. The admin has the rest, and an email is the copy of an
 * order most likely to end up forwarded, printed or sitting in a breached
 * inbox. The one exception is the booking mail, which carries the buyer's
 * email/phone — the seller may need to reach them about the time, and the
 * conversation is the point of a booking.
 */

/** Where every one of these mails points: the order queue, not a detail page. */
function ordersUrl(): string {
  return `${appUrl()}/admin/orders`;
}

function methodName(order: Order): string {
  return isPaymentMethodType(order.paymentMethod)
    ? PAYMENT_METHOD_DEFS[order.paymentMethod].name
    : order.paymentMethod;
}

/**
 * Sent when an order settles — at checkout on the manual rails, on
 * `checkout.session.completed` for card. Exactly one of the two sites fires
 * per order; the discriminator is the same `settlesAtCheckout` the buyer's
 * confirmation already uses.
 */
export async function sendSellerOrderPlaced(opts: {
  shop: Shop;
  order: Order;
  items: OrderLine[];
  /** Resolved by the caller: `shop.contactEmail`, else the account email. */
  to: string;
}): Promise<SendResult> {
  const { shop, order, items, to } = opts;
  const amount = formatMoney(order.totalCents, order.currency);

  const body = `
    ${mutedPara(
      `${order.customerName ? strong(esc(order.customerName)) : "Someone"} just ordered from ${esc(shop.name)}.`,
    )}
    ${section("What they ordered", itemRows(items, order.currency, shop.timeZone) + moneyRows(order))}
    ${section(
      "Payment",
      detailTable([
        { label: "Method", value: methodName(order) },
        { label: "Status", value: order.paymentStatus === "paid" ? "Paid" : "To collect" },
      ]),
    )}
    ${button(ordersUrl(), "Open your orders")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `New order — ${amount}`,
    html: sailoLayout("You have a new order", body, {
      preheader: `${orderSummaryTitle(order)} · ${amount}`,
    }),
    // A reply should reach the buyer, who is the person with the follow-up.
    replyTo: order.customerEmail ?? undefined,
  });
}

/**
 * Sent instead of the order mail when the order carries a requested
 * appointment — the seller's next move is accept or decline, not fulfil,
 * and checkout promised the buyer an answer.
 */
export async function sendSellerBookingRequested(opts: {
  shop: Shop;
  order: Order;
  items: OrderLine[];
  to: string;
}): Promise<SendResult> {
  const { shop, order, items, to } = opts;
  const amount = formatMoney(order.totalCents, order.currency);
  const when = order.scheduledFor
    ? formatWhen(order.scheduledFor, shop.timeZone, "long")
    : null;

  // The seller has to be able to answer — a booking is a conversation.
  const contactRows: Detail[] = [
    { label: "Name", value: order.customerName ?? "" },
    { label: "Email", value: order.customerEmail ?? "" },
    { label: "Phone", value: order.customerPhone ?? "" },
  ];

  const body = `
    ${mutedPara(
      `${order.customerName ? strong(esc(order.customerName)) : "Someone"} asked to book ${esc(orderSummaryTitle(order))}${when ? ` for ${strong(esc(when))}` : ""}.`,
    )}
    ${para("The time isn't agreed until you confirm it — the buyer was told to expect your answer.")}
    ${
      when
        ? section(
            "Requested time",
            detailTable([
              { label: "When", value: when },
              { label: "Time zone", value: shop.timeZone },
            ]),
          )
        : ""
    }
    ${section("Buyer", detailTable(contactRows))}
    ${section("Order", itemRows(items, order.currency, shop.timeZone) + moneyRows(order))}
    ${button(ordersUrl(), "Confirm or decline")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `Booking request — ${amount}`,
    html: sailoLayout("New booking request", body, {
      preheader: when
        ? `${orderSummaryTitle(order)} · ${when}`
        : `${orderSummaryTitle(order)} · ${amount}`,
    }),
    replyTo: order.customerEmail ?? undefined,
  });
}

/**
 * Sent when a buyer reports a manual payment — a bank-transfer reference or
 * an uploaded proof. The money says it moved; only the seller can confirm it.
 */
export async function sendSellerOrderNeedsAction(opts: {
  shop: Shop;
  order: Order;
  to: string;
  /** What the buyer just supplied. */
  supplied: "reference" | "proof";
}): Promise<SendResult> {
  const { shop, order, to, supplied } = opts;
  const amount = formatMoney(order.totalCents, order.currency);

  const body = `
    ${mutedPara(
      supplied === "proof"
        ? `${order.customerName ? strong(esc(order.customerName)) : "A buyer"} uploaded proof of payment for an order at ${esc(shop.name)}.`
        : `${order.customerName ? strong(esc(order.customerName)) : "A buyer"} says they've sent the payment for an order at ${esc(shop.name)}.`,
    )}
    ${section(
      "Order",
      detailTable([
        { label: "What", value: orderSummaryTitle(order) },
        { label: "Total", value: amount },
        { label: "Method", value: methodName(order) },
        { label: "Reference", value: order.paymentReference ?? "" },
      ]),
    )}
    ${fine("Check the money actually arrived before you mark it paid — a reference is a claim, not a receipt.")}
    ${button(ordersUrl(), "Review and confirm")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `Payment reported — ${amount}`,
    html: sailoLayout("A payment needs your confirmation", body, {
      preheader: `${orderSummaryTitle(order)} · ${amount} reported ${supplied === "proof" ? "with proof attached" : "as sent"}.`,
    }),
    replyTo: order.customerEmail ?? undefined,
  });
}

/**
 * Sent when we stop delivering to a webhook endpoint that has failed
 * `failures` times in a row.
 *
 * The only message here that is not about an order, and it exists because the
 * failure it reports is otherwise completely silent. A seller's Zap stops
 * firing; nothing in their inbox, nothing on their dashboard, and the shop
 * carries on selling perfectly — so the first sign is a customer asking why
 * they never got the thing the Zap was supposed to send. An email is the only
 * channel that reaches somebody who is not currently looking at the admin.
 *
 * The URL is named because a shop may have several endpoints and "one of your
 * webhooks" is not actionable. `reason` is whatever the last attempt actually
 * said — a status code, a timeout, a refused address — since that is the
 * sentence they will forward to whoever runs the receiving end.
 */
export async function sendSellerWebhookDisabled(opts: {
  shop: Shop;
  to: string;
  url: string;
  label: string | null;
  reason: string;
  failures: number;
}): Promise<SendResult> {
  const { shop, to, url, label, reason, failures } = opts;

  const body = `
    ${mutedPara(
      `We've stopped sending events to a webhook endpoint on ${esc(shop.name)} after ${failures} failed attempts in a row.`,
    )}
    ${section(
      "The endpoint",
      detailTable([
        { label: "Name", value: label ?? "—" },
        { label: "URL", value: url },
        { label: "Last error", value: reason },
      ]),
    )}
    ${mutedPara(
      "Nothing has been lost from your shop — orders, payments and customers were all recorded normally. What stopped is the copy we were forwarding to this address.",
    )}
    ${fine("Fix the receiving end, then switch the endpoint back on in Settings → Integrations. Events that failed while it was off are not resent.")}
    ${button(`${appUrl()}/admin/settings/integrations`, "Open integrations")}
  `;

  return send({
    from: sender("Sailo", ORDERS),
    to,
    subject: `Webhook switched off — ${label ?? url}`,
    html: sailoLayout("A webhook endpoint stopped working", body, {
      preheader: `${failures} failed attempts in a row. Last error: ${reason}`,
    }),
  });
}
