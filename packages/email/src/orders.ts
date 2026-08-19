import "server-only";
import type { Order, Shop } from "@sailo/db/schema";
import { orderSummaryTitle } from "@sailo/core/order-lines";
import { formatAddress } from "@sailo/core/address";
import { formatMoney } from "@sailo/core/currency";
import { ORDERS, send, sender, type SendResult } from "@sailo/mailer/transport";
import {
  button,
  mutedPara,
  detailTable,
  esc,
  fine,
  formatWhen,
  layout,
  para,
  section,
  strong,
} from "@sailo/mailer/markup";

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

/**
 * Sent when the seller marks a shipping order as dispatched.
 *
 * Carries the arrival question when there is one to carry. Spec 44: on
 * `product_not_received` the whole case turns on delivery, and the cardholder's
 * own timestamped "yes, it arrived" is stronger evidence than a seller's tick
 * and than a tracking number that says "in transit". This email is the one
 * moment a buyer is already thinking about the parcel, so it is where the
 * question costs least to ask.
 */
export async function sendShippingNotification(opts: {
  shop: Shop;
  order: Order;
  /**
   * The signed arrival link, when the caller could mint one.
   *
   * Passed in rather than built here so this module keeps its property of
   * touching no secrets. Null when `BETTER_AUTH_SECRET` is unset, and the mail
   * then simply goes without the question — a link that does not verify is worse
   * than no link, because a buyer who clicks it and is refused concludes their
   * order is wrong.
   */
  arrivalUrl?: string | null;
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
    ${
      opts.arrivalUrl
        ? fine(
            `Once it lands, <a href="${esc(opts.arrivalUrl)}">let ${esc(shop.name)} know it arrived</a>.`,
          )
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

/**
 * The event details an email may show, already gated.
 *
 * `joinUrl` arrives null unless the order has been released — see
 * `lib/event-access.ts`, which is the only thing allowed to decide that. This
 * module renders what it is given and does not re-derive the rule, because
 * two places deciding the same thing is how one of them comes to decide it
 * differently.
 */
export type EventDetails = {
  title: string;
  startsAt: Date | null;
  joinUrl: string | null;
  location: string | null;
  online: boolean;
};

/**
 * The block an event gets in any email: when it is, and how to get in.
 *
 * Both times are printed. The instant is one moment, but "18:00" means two
 * different things to a seller in Lisbon and a buyer in Warsaw, and a
 * webinar's single most common support ticket is somebody arriving an hour
 * late. Naming the zone next to the time is what stops that, and it costs a
 * parenthesis.
 */
/*
 * Exported because `sendEventReminder` still lives in apps/web — it is sent by
 * a cron rather than by a seller touching an order, so it stayed behind while
 * the lifecycle messages moved. Both need to render an event the same way, and
 * two renderings is a buyer told two different start times.
 */
export function eventBlock(event: EventDetails, timeZone: string | undefined): string {
  const when = event.startsAt
    ? `${esc(formatWhen(event.startsAt, timeZone, "long"))} (${esc(timeZone ?? "UTC")})`
    : "";

  return [
    para(strong(esc(event.title))),
    when ? mutedPara(when) : "",
    event.joinUrl ? button(event.joinUrl, "Join the event") : "",
    !event.joinUrl && event.online
      ? fine("Your join link appears here once your payment is confirmed.")
      : "",
    event.location ? mutedPara(esc(event.location)) : "",
  ].join("\n");
}

/**
 * Sent when a digital order's files unlock — either right after ordering, or
 * once the seller confirms the payment that was holding them back.
 */
export async function sendDownloadReady(opts: {
  shop: Shop;
  order: Order;
  url: string;
  /**
   * Events this order registered for, with their join links.
   *
   * This is the moment an online event's link becomes deliverable — the
   * release claim above it is the same one that unlocks a file — so the mail
   * that announces the unlock is the mail that must carry it. Without this an
   * event buyer got an email headed "Your files are ready" describing files
   * that do not exist, and had to find the link by revisiting a page nobody
   * told them to bookmark.
   */
  events?: EventDetails[];
  /** Whether the order carries admissions, so the copy can say "tickets". */
  hasTickets?: boolean;
}): Promise<SendResult> {
  const { shop, order, url } = opts;
  if (!order.customerEmail) return { sent: false, reason: "no customer email" };

  const events = opts.events ?? [];
  const admits = opts.hasTickets || events.length > 0;
  const noun = admits ? "tickets" : "files";

  const expiresOn = order.downloadExpiresAt
    ? order.downloadExpiresAt.toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const body = `
    ${para(`Your ${noun} are ready — open them below.`)}
    ${para(strong(orderSummaryTitle(order)))}
    ${events.map((event) => section("Your event", eventBlock(event, shop.timeZone))).join("\n")}
    ${button(url, admits ? "View your tickets" : "Download your files")}
    ${
      // Download terms, and only when there is a download. A ticket does not
      // stop admitting because a file's cap ran out.
      !admits && order.downloadLimit
        ? fine(
            `You can download ${order.downloadLimit} time${order.downloadLimit === 1 ? "" : "s"}.`,
          )
        : ""
    }
    ${!admits && expiresOn ? fine(`The link works until ${esc(expiresOn)}.`) : ""}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject: admits
      ? `Your tickets from ${shop.name}`
      : `Your download from ${shop.name}`,
    html: layout(shop, admits ? "Your tickets are ready" : "Your download is ready", body, {
      preheader: `Your ${noun} from ${shop.name} are ready.`,
    }),
    replyTo: shop.contactEmail ?? undefined,
  });
}
