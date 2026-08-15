import "server-only";
import type { Order, Shop } from "@sailo/db/schema";
import { orderSummaryTitle } from "@sailo/commerce/order-lines";
import { formatAddress } from "@sailo/core/address";
import { formatMoney } from "@sailo/core/currency";
import { ORDERS, send, sender, type SendResult } from "./transport";
import {
  button,
  detailTable,
  esc,
  fine,
  formatWhen,
  layout,
  para,
  section,
  strong,
} from "./markup";

/**
 * The three messages an order's own lifecycle sends.
 *
 * WHY THESE THREE AND NOT THE OTHER SIXTEEN
 *
 * They are the ones a seller triggers by *changing an order*, which is the one
 * thing the phone could not do. Everything else in `apps/web/src/lib/email` is
 * sent by something only the website has — a checkout completing, a webhook
 * arriving, a marketing schedule running — and moving those would be moving
 * code for the sake of tidiness rather than to unblock a caller.
 *
 * `orders.updateStatus` in `packages/api` has carried a note about this since
 * it was written: a seller who confirms or declines a booking from their phone
 * left the buyer un-emailed, and it named this package as the fix. The
 * refund and the shipping notice are the same shape of gap, and worse — money
 * moving with nobody told.
 *
 * WHAT THEY ALL AGREE ON
 *
 * A message with nowhere to go is not a failure. Every one of these returns
 * `{ sent: false, reason }` when the order carries no customer email rather
 * than throwing — an order taken over the counter has no address to write to,
 * and that is a fact about the order, not an error in the send.
 */

/** Sent when the seller marks a shipping order as dispatched. */
export async function sendShippingNotification(opts: {
  shop: Shop;
  order: Order;
}): Promise<SendResult> {
  const { shop, order } = opts;
  if (!order.customerEmail) return { sent: false, reason: "no customer email" };

  const address = formatAddress(order);

  const body = `
    ${para("Good news — your order is on its way.")}
    ${section(
      "Shipment",
      detailTable([
        { label: "Order", value: orderSummaryTitle(order) },
        { label: "Carrier", value: order.trackingCarrier ?? "" },
        { label: "Tracking", value: order.trackingNumber ?? "" },
      ]),
    )}
    ${
      address
        ? section(
            "Delivering to",
            para(
              `${order.customerName ? `${esc(order.customerName)}<br>` : ""}${esc(address)}`,
            ),
          )
        : ""
    }
    ${order.trackingUrl ? button(order.trackingUrl, "Track your parcel") : ""}
    ${
      order.trackingNumber && !order.trackingUrl
        ? fine("Use the tracking number above on the carrier's website for live updates.")
        : ""
    }
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject: `Your order from ${shop.name} has shipped`,
    html: layout(shop, "On its way", body, {
      preheader: `${orderSummaryTitle(order)} has shipped${order.trackingCarrier ? ` with ${order.trackingCarrier}` : ""}.`,
    }),
    replyTo: shop.contactEmail ?? undefined,
  });
}

/**
 * The seller accepting or declining a requested appointment.
 *
 * Checkout promises that the shop confirms the slot afterwards, and until now
 * nothing kept that promise: the order simply became "confirmed" when the
 * money arrived, without anybody agreeing to the time. These are the two
 * answers a buyer can actually receive.
 */
export async function sendBookingDecision(opts: {
  shop: Shop;
  order: Order;
  accepted: boolean;
}): Promise<SendResult> {
  const { shop, order, accepted } = opts;
  if (!order.customerEmail) return { sent: false, reason: "no customer email" };
  if (!order.scheduledFor) return { sent: false, reason: "order has no booking" };

  /*
   * Written in the shop's zone, not the server's or the buyer's. The
   * appointment is a time to turn up somewhere, and the seller's clock is the
   * one both of them have to agree on.
   */
  const when = formatWhen(order.scheduledFor, shop.timeZone, "long");

  const body = accepted
    ? `
    ${para("Your appointment is confirmed — here are the details.")}
    ${section(
      "Appointment",
      detailTable([
        { label: "What", value: orderSummaryTitle(order) },
        { label: "When", value: when },
        { label: "Time zone", value: shop.timeZone },
        {
          label: order.serviceMode === "online" ? "Join at" : "Where",
          value: order.serviceLocation ?? "",
        },
      ]),
    )}
  `
    : `
    ${para(
      `${esc(shop.name)} can't make ${strong(when)} after all, and has cancelled this booking.`,
    )}
    ${para(`If you've already paid, ${esc(shop.name)} will refund you.`)}
    ${section(
      "Cancelled booking",
      detailTable([
        { label: "What", value: orderSummaryTitle(order) },
        { label: "When", value: when },
      ]),
    )}
    ${
      // Only invite a reply that will actually reach the seller.
      shop.contactEmail
        ? fine("Reply to this email to arrange another time.")
        : ""
    }
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject: accepted
      ? `Your appointment with ${shop.name} is confirmed`
      : `Your appointment with ${shop.name} was cancelled`,
    html: layout(shop, accepted ? "Confirmed" : "Cancelled", body, {
      preheader: accepted
        ? `Confirmed — ${when}.`
        : `${shop.name} can't make ${when}.`,
    }),
    // The buyer will want to answer a decline, and often an acceptance.
    replyTo: shop.contactEmail ?? undefined,
  });
}

/** Sent when the seller records a refund. */
export async function sendRefundNotification(opts: {
  shop: Shop;
  order: Order;
}): Promise<SendResult> {
  const { shop, order } = opts;
  if (!order.customerEmail) return { sent: false, reason: "no customer email" };

  const amount = formatMoney(order.refundedCents, order.currency);
  // A partial refund says so by showing what the whole order was.
  const partial = order.refundedCents < order.totalCents;

  const body = `
    ${para(`${esc(shop.name)} has refunded ${strong(amount)} for your order.`)}
    ${section(
      "Refund details",
      detailTable([
        { label: "Order", value: orderSummaryTitle(order) },
        { label: "Refunded", value: amount },
        {
          label: "Order total",
          value: partial ? formatMoney(order.totalCents, order.currency) : "",
        },
        { label: "Reason", value: order.refundReason ?? "" },
      ]),
    )}
    ${fine("Depending on your bank, it can take a few working days to appear.")}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject: `Refund from ${shop.name}`,
    html: layout(shop, "Refund issued", body, {
      preheader: `${amount} refunded by ${shop.name}.`,
    }),
    replyTo: shop.contactEmail ?? undefined,
  });
}
