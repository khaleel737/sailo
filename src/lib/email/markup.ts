import type { Order, Shop } from "@/db/schema";
import { formatMoney } from "@/lib/utils";

/**
 * The HTML an email is built from.
 *
 * Every value that reaches the markup goes through `esc` first. An order
 * carries text the buyer typed — their name, their note — and a shop carries
 * text its owner typed, so both are someone else's input by the time they
 * arrive here.
 */

export const esc = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function layout(shop: Shop, heading: string, body: string) {
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

export function moneyRows(order: Order) {
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

/**
 * The shell for mail Sailo sends as itself — no shop name above it, because
 * no shop is involved. `layout` is the other one: a shop talking to its buyer.
 */
export function sailoLayout(heading: string, body: string) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a20;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e6ea;border-radius:16px;">
    <tr><td style="padding:28px;">
      <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3;">${esc(heading)}</h1>
      ${body}
    </td></tr>
  </table>
  <p style="max-width:560px;margin:16px auto 0;text-align:center;font-size:12px;color:#b8b8c2;">Sailo</p>
</body></html>`;
}

export function button(href: string, label: string) {
  return `<a href="${esc(href)}" style="display:inline-block;margin-top:20px;padding:11px 20px;background:#1a1a20;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">${esc(label)}</a>`;
}
