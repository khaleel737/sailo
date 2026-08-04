import "server-only";
import { Resend } from "resend";
import type { Order, Shop } from "@/db/schema";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { formatAddress, formatMoney } from "@/lib/utils";

let client: Resend | null = null;

function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY);

const FROM = () => process.env.SAILO_FROM_EMAIL ?? "Sailo <onboarding@resend.dev>";

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: string };

async function send(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<SendResult> {
  const api = resend();
  if (!api) return { sent: false, reason: "RESEND_API_KEY is not set" };

  try {
    const { data, error } = await api.emails.send({
      from: FROM(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      replyTo: opts.replyTo,
    });
    if (error) return { sent: false, reason: error.message };
    return { sent: true, id: data?.id ?? "" };
  } catch (error) {
    // Email must never take an order down with it.
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "unknown error",
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Templates                                                                  */
/* -------------------------------------------------------------------------- */

const esc = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function layout(shop: Shop, heading: string, body: string) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a20;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e6ea;border-radius:16px;">
    <tr><td style="padding:28px 28px 0;">
      <p style="margin:0;font-size:13px;color:#8e8e9c;">${esc(shop.name)}</p>
      <h1 style="margin:6px 0 0;font-size:20px;line-height:1.3;">${esc(heading)}</h1>
    </td></tr>
    <tr><td style="padding:20px 28px 28px;">${body}</td></tr>
  </table>
  <p style="max-width:560px;margin:16px auto 0;text-align:center;font-size:12px;color:#b8b8c2;">
    Sent by ${esc(shop.name)} via Sailo
  </p>
</body></html>`;
}

function moneyRows(order: Order) {
  const row = (label: string, value: string, bold = false) =>
    `<tr>
      <td style="padding:4px 0;font-size:14px;color:#565664;">${esc(label)}</td>
      <td style="padding:4px 0;font-size:14px;text-align:right;${bold ? "font-weight:600;" : ""}">${esc(value)}</td>
    </tr>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid #ededf0;padding-top:8px;">
    ${row("Subtotal", formatMoney(order.subtotalCents, order.currency))}
    ${
      order.discountCents > 0
        ? row(
            `Discount${order.couponCode ? ` (${order.couponCode})` : ""}`,
            `−${formatMoney(order.discountCents, order.currency)}`,
          )
        : ""
    }
    ${
      order.deliveryFeeCents > 0
        ? row(
            order.deliveryLabel ?? "Delivery",
            formatMoney(order.deliveryFeeCents, order.currency),
          )
        : ""
    }
    ${row("Total", formatMoney(order.totalCents, order.currency), true)}
  </table>`;
}

function button(href: string, label: string) {
  return `<a href="${esc(href)}" style="display:inline-block;margin-top:20px;padding:11px 20px;background:#1a1a20;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">${esc(label)}</a>`;
}

/** Sent to the buyer the moment they order. */
export async function sendOrderConfirmation(opts: {
  shop: Shop;
  order: Order;
  invoiceUrl: string | null;
  invoiceNumber: string | null;
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
    <p style="margin:0;font-size:15px;font-weight:600;">
      ${esc(order.productTitle)}${order.quantity > 1 ? ` × ${order.quantity}` : ""}
    </p>
    ${moneyRows(order)}
    <div style="margin-top:18px;">
      ${detail("Payment", methodName)}
      ${order.deliveryLabel ? detail("Delivery", order.deliveryLabel) : ""}
      ${order.pickupLocation ? detail("Collect from", order.pickupLocation) : ""}
      ${address ? detail("Deliver to", address) : ""}
      ${opts.invoiceNumber ? detail("Invoice", opts.invoiceNumber) : ""}
    </div>
    ${opts.invoiceUrl ? button(opts.invoiceUrl, "View your invoice") : ""}
  `;

  return send({
    to: order.customerEmail,
    subject: `Your order from ${shop.name}`,
    html: layout(shop, "Order confirmed", body),
    replyTo: shop.contactEmail ?? undefined,
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
      ${esc(order.productTitle)}${order.quantity > 1 ? ` × ${order.quantity}` : ""}
    </p>
    <div style="margin-top:16px;">
      ${order.trackingCarrier ? detail("Carrier", order.trackingCarrier) : ""}
      ${order.trackingNumber ? detail("Tracking number", order.trackingNumber) : ""}
    </div>
    ${order.trackingUrl ? button(order.trackingUrl, "Track your parcel") : ""}
  `;

  return send({
    to: order.customerEmail,
    subject: `Your order from ${shop.name} has shipped`,
    html: layout(shop, "On its way", body),
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
      ${esc(order.productTitle)}${order.quantity > 1 ? ` × ${order.quantity}` : ""}
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
    to: order.customerEmail,
    subject: `Refund from ${shop.name}`,
    html: layout(shop, "Refund issued", body),
    replyTo: shop.contactEmail ?? undefined,
  });
}
