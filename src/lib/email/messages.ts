import "server-only";
import type { Order, Shop } from "@/db/schema";
import { orderSummaryTitle, type OrderLine } from "@/lib/order-lines";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { formatAddress, formatMoney } from "@/lib/utils";
import { ACCOUNTS, ORDERS, PARTNERS, send, sender, type SendResult } from "./transport";
import { button, esc, layout, moneyRows, sailoLayout } from "./markup";

/** Every message Sailo sends. */

/** Sent to the buyer the moment they order. */
export async function sendOrderConfirmation(opts: {
  shop: Shop;
  order: Order;
  /**
   * Every line. Required, not optional: an optional list with a header
   * fallback is how a two-line order came to be emailed as one line at the
   * wrong price.
   */
  items: OrderLine[];
  invoiceUrl: string | null;
  invoiceNumber: string | null;
  /** Set once a digital order's files are already unlocked. */
  downloadUrl?: string | null;
  /** Set when they're waiting on the seller confirming payment. */
  downloadPending?: boolean;
}): Promise<SendResult> {
  const { shop, order } = opts;
  if (!order.customerEmail) return { sent: false, reason: "no customer email" };

  const methodName = isPaymentMethodType(order.paymentMethod)
    ? PAYMENT_METHOD_DEFS[order.paymentMethod].name
    : order.paymentMethod;
  const address = formatAddress(order);

  const detail = (label: string, value: string) =>
    `<p style="margin:2px 0;font-size:14px;color:#565664;">${esc(label)}: <span style="color:#1a1a20;">${esc(value)}</span></p>`;

  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Thanks${order.customerName ? ` ${esc(order.customerName)}` : ""} — ${esc(shop.name)} has your order.
    </p>
    ${opts.items
      .map(
        (item) => `<p style="margin:0 0 4px;font-size:15px;font-weight:600;">
      ${esc(item.title)}${item.variantLabel ? ` — ${esc(item.variantLabel)}` : ""}${item.quantity > 1 ? ` × ${item.quantity}` : ""}
      <span style="float:right;font-weight:400;color:#565664;">${esc(formatMoney(item.subtotalCents, order.currency))}</span>
    </p>${
      item.scheduledFor
        ? `<p style="margin:0 0 8px;font-size:13px;color:#8e8e9c;">${esc(
            item.scheduledFor.toLocaleString("en-US", {
              weekday: "short",
              day: "numeric",
              month: "long",
              hour: "numeric",
              minute: "2-digit",
            }),
          )}</p>`
        : ""
    }`,
      )
      .join("")}
    ${moneyRows(order)}
    <div style="margin-top:18px;">
      ${detail("Payment", methodName)}
      ${order.deliveryLabel ? detail("Delivery", order.deliveryLabel) : ""}
      ${order.pickupLocation ? detail("Collect from", order.pickupLocation) : ""}
      ${address ? detail("Deliver to", address) : ""}
      ${
        order.serviceLocation
          ? detail(
              order.serviceMode === "online" ? "Joining details" : "Where",
              order.serviceLocation,
            )
          : ""
      }
      ${opts.invoiceNumber ? detail("Invoice", opts.invoiceNumber) : ""}
    </div>
    ${
      opts.downloadUrl
        ? button(opts.downloadUrl, "Get your files")
        : opts.downloadPending
          ? `<p style="margin:16px 0 0;font-size:14px;color:#565664;">Your download unlocks as soon as ${esc(shop.name)} confirms your payment — we'll email you the link.</p>`
          : ""
    }
    ${opts.invoiceUrl ? button(opts.invoiceUrl, "View your invoice") : ""}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject: `Your order from ${shop.name}`,
    html: layout(shop, "Order confirmed", body),
    replyTo: shop.contactEmail ?? undefined,
  });
}

/**
 * Sent when a digital order's files unlock — either right after ordering, or
 * once the seller confirms the payment that was holding them back.
 */
export async function sendDownloadReady(opts: {
  shop: Shop;
  order: Order;
  url: string;
}): Promise<SendResult> {
  const { shop, order, url } = opts;
  if (!order.customerEmail) return { sent: false, reason: "no customer email" };

  const expiry = order.downloadExpiresAt
    ? `<p style="margin:12px 0 0;font-size:13px;color:#8e8e9c;">This link works until ${esc(
        order.downloadExpiresAt.toLocaleDateString("en-US", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      )}.</p>`
    : "";

  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Your download is ready.
    </p>
    <p style="margin:0;font-size:15px;font-weight:600;">
      ${esc(orderSummaryTitle(order))}
    </p>
    ${button(url, "Get your files")}
    ${
      order.downloadLimit
        ? `<p style="margin:12px 0 0;font-size:13px;color:#8e8e9c;">You can download ${order.downloadLimit} time${order.downloadLimit === 1 ? "" : "s"}.</p>`
        : ""
    }
    ${expiry}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject: `Your download from ${shop.name}`,
    html: layout(shop, "Ready to download", body),
    replyTo: shop.contactEmail ?? undefined,
  });
}

/**
 * The affiliate's own report links, one per shop they promote. Sent only to an
 * address that already has an active affiliate row against it.
 */
export async function sendPortalLinks(opts: {
  to: string;
  links: { shopName: string; url: string }[];
}): Promise<SendResult> {
  const { to, links } = opts;
  if (links.length === 0) return { sent: false, reason: "no links" };

  const rows = links
    .map(
      (l) =>
        `<p style="margin:0 0 10px;font-size:15px;">
          <a href="${esc(l.url)}" style="color:#1a1a20;font-weight:600;">${esc(l.shopName)}</a>
        </p>`,
    )
    .join("");

  const html = sailoLayout(
    "Your referral report",
    `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#565664;">
        ${links.length === 1 ? "Here's your private link." : `Here are your private links — one for each shop you promote.`}
        Keep them to yourself: anyone with a link can see your earnings.
      </p>
      ${rows}`,
  );

  return send({
    from: sender("Sailo", PARTNERS),
    to,
    subject: "Your referral report",
    html,
  });
}

/** Sent when the seller marks a shipping order as dispatched. */
export async function sendShippingNotification(opts: {
  shop: Shop;
  order: Order;
}): Promise<SendResult> {
  const { shop, order } = opts;
  if (!order.customerEmail) return { sent: false, reason: "no customer email" };

  const detail = (label: string, value: string) =>
    `<p style="margin:2px 0;font-size:14px;color:#565664;">${esc(label)}: <span style="color:#1a1a20;">${esc(value)}</span></p>`;

  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Your order is on its way.
    </p>
    <p style="margin:0;font-size:15px;font-weight:600;">
      ${esc(orderSummaryTitle(order))}
    </p>
    <div style="margin-top:16px;">
      ${order.trackingCarrier ? detail("Carrier", order.trackingCarrier) : ""}
      ${order.trackingNumber ? detail("Tracking number", order.trackingNumber) : ""}
    </div>
    ${order.trackingUrl ? button(order.trackingUrl, "Track your parcel") : ""}
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject: `Your order from ${shop.name} has shipped`,
    html: layout(shop, "On its way", body),
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
  const when = order.scheduledFor.toLocaleString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: shop.timeZone,
  });

  const body = accepted
    ? `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Your appointment is confirmed.
    </p>
    <p style="margin:0;font-size:15px;font-weight:600;">${esc(orderSummaryTitle(order))}</p>
    <p style="margin:8px 0 0;font-size:15px;">${esc(when)}</p>
    <p style="margin:4px 0 0;font-size:13px;color:#8e8e9c;">${esc(shop.timeZone)}</p>
  `
    : `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      ${esc(shop.name)} can't make ${esc(when)} after all, and has cancelled
      this booking. Anything you paid is being returned.
    </p>
    <p style="margin:0;font-size:15px;font-weight:600;">${esc(orderSummaryTitle(order))}</p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.6;">
      Reply to this email to arrange another time.
    </p>
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject: accepted
      ? `Your appointment with ${shop.name} is confirmed`
      : `Your appointment with ${shop.name} was cancelled`,
    html: layout(shop, accepted ? "Confirmed" : "Cancelled", body),
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

  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      ${esc(shop.name)} has refunded
      <strong>${esc(formatMoney(order.refundedCents, order.currency))}</strong>
      for your order.
    </p>
    <p style="margin:0;font-size:15px;font-weight:600;">
      ${esc(orderSummaryTitle(order))}
    </p>
    ${
      order.refundReason
        ? `<p style="margin:12px 0 0;font-size:14px;color:#565664;">${esc(order.refundReason)}</p>`
        : ""
    }
    <p style="margin:16px 0 0;font-size:13px;color:#8e8e9c;">
      Depending on your bank this can take a few working days to appear.
    </p>
  `;

  return send({
    from: sender(shop.name, ORDERS),
    to: order.customerEmail,
    subject: `Refund from ${shop.name}`,
    html: layout(shop, "Refund issued", body),
    replyTo: shop.contactEmail ?? undefined,
  });
}

/**
 * The link that lets someone back into their own account.
 *
 * Deliberately sparse: no order data, no shop branding, nothing worth
 * harvesting if it lands in the wrong inbox. It says how long the link lasts
 * and what to do if they didn't ask for it, because a reset mail nobody
 * requested is the first sign of someone trying the door.
 */
/**
 * The way into /hq. Staff don't have a password to type — this link, sent only
 * to an address on the roster in `lib/staff.ts`, is the whole sign-in.
 *
 * As sparse as the password reset, and for the same reason: it lands in an
 * inbox, and inboxes get read by the wrong people. It names no panel features
 * and carries nothing but the link and how long it lasts.
 */
export async function sendHqSignInLink(opts: {
  to: string;
  url: string;
  /** How long the link stays good, in whole minutes. */
  expiresInMinutes: number;
}): Promise<SendResult> {
  const { to, url, expiresInMinutes } = opts;

  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#565664;">
      Here's your sign-in link for <strong style="color:#1a1a20;">${esc(to)}</strong>.
    </p>
    ${button(url, "Sign in")}
    <p style="margin:18px 0 0;font-size:13px;color:#8e8e9c;">
      This link works once, and expires in ${expiresInMinutes} minute${expiresInMinutes === 1 ? "" : "s"}.
    </p>
    <p style="margin:8px 0 0;font-size:13px;color:#8e8e9c;">
      If you didn't ask for it, ignore this email — nobody gets in without it.
    </p>
  `;

  return send({
    from: sender("Sailo", ACCOUNTS),
    to,
    subject: "Your Sailo sign-in link",
    html: sailoLayout("Sign in to Sailo", body),
  });
}

/**
 * Proof that a new seller's address is really theirs.
 *
 * Sent on sign-up. Not a gate — they can use their admin while it waits — but
 * until they click it, the account is only a claim to an inbox, and a claim is
 * all an impostor has. Sparse like the other account mail: whoever typed the
 * address might not be its owner, and the wrong inbox should learn nothing.
 */
export async function sendEmailConfirmation(opts: {
  to: string;
  name?: string | null;
  url: string;
}): Promise<SendResult> {
  const { to, name, url } = opts;

  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#565664;">
      ${name ? `Hi ${esc(name)} — ` : ""}a Sailo account was just created with
      <strong style="color:#1a1a20;">${esc(to)}</strong>. One click confirms
      this address is yours.
    </p>
    ${button(url, "Confirm my email")}
    <p style="margin:18px 0 0;font-size:13px;color:#8e8e9c;">
      If you didn't create this account, ignore this email — unconfirmed, it
      goes nowhere.
    </p>
  `;

  return send({
    from: sender("Sailo", ACCOUNTS),
    to,
    subject: "Confirm your email",
    html: sailoLayout("Confirm your email", body),
  });
}

export async function sendPasswordReset(opts: {
  to: string;
  name?: string | null;
  url: string;
  /** How long the link stays good, in whole hours. */
  expiresInHours: number;
}): Promise<SendResult> {
  const { to, name, url, expiresInHours } = opts;

  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#565664;">
      ${name ? `Hi ${esc(name)} — ` : ""}someone asked to reset the password for
      the Sailo account on <strong style="color:#1a1a20;">${esc(to)}</strong>.
    </p>
    ${button(url, "Choose a new password")}
    <p style="margin:18px 0 0;font-size:13px;color:#8e8e9c;">
      This link works once, and expires in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"}.
    </p>
    <p style="margin:8px 0 0;font-size:13px;color:#8e8e9c;">
      If this wasn't you, ignore this email — your password stays as it is.
    </p>
  `;

  return send({
    from: sender("Sailo", ACCOUNTS),
    to,
    subject: "Reset your Sailo password",
    html: sailoLayout("Reset your password", body),
  });
}
