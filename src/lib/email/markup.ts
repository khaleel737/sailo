import type { Order, Shop } from "@/db/schema";
import { badgeHref, showsBadge } from "@/components/shared/powered-by";
import { APP_URL } from "@/lib/seo";
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

/* --------------------------------------------------------------------------
   The footer line

   Two things were wrong with it and they compounded. The badge was #b8b8c2 on
   a #f7f7f8 background — 1.84:1, where 4.5:1 is the floor for text this size —
   so on most screens it simply was not there. And it was never a link, so the
   one visitor who did read it had nothing to press. The free tier's whole
   argument is that a shop's own mail is a distribution channel; an invisible,
   unclickable, untagged line is not a channel.

   #6b6b78 clears the floor at 4.90:1 and stays quieter than the body text
   above it. The name itself carries the app's ink so it reads as the pressable
   part, underlined because an email has none of the hover affordances a page
   has and the underline is the only thing saying "link".
-------------------------------------------------------------------------- */

const FOOTER = "max-width:560px;margin:16px auto 0;text-align:center;font-size:12px;color:#6b6b78;";
const FOOTER_LINK = "color:#1a1a20;font-weight:600;text-decoration:underline;";

export function layout(shop: Shop, heading: string, body: string) {
  /*
   * Gated by the same rule the storefront badge uses, and it has to be: a shop
   * on Pro or Business pays to take Sailo's name off its shop, and its
   * customers' receipts are no less theirs than its pages are. Reading the
   * plan here rather than deciding locally is what keeps the two surfaces from
   * drifting apart — which is exactly how the invoice page ended up branding
   * shops that had paid not to be.
   */
  const footer = showsBadge(shop)
    ? `Sent by ${esc(shop.name)} via <a href="${esc(badgeHref(shop.handle, APP_URL, "email"))}" style="${FOOTER_LINK}">Sailo</a> — open your own shop, free`
    : `Sent by ${esc(shop.name)}`;

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a20;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e6ea;border-radius:16px;">
    <tr><td style="padding:28px 28px 0;">
      <p style="margin:0;font-size:13px;color:#8e8e9c;">${esc(shop.name)}</p>
      <h1 style="margin:6px 0 0;font-size:20px;line-height:1.3;">${esc(heading)}</h1>
    </td></tr>
    <tr><td style="padding:20px 28px 28px;">${body}</td></tr>
  </table>
  <p style="${FOOTER}">
    ${footer}
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
/**
 * Where Sailo's own mail points its name. No shop sent it, so there is no
 * handle to credit — the campaign still separates it from the badge, because a
 * click from a referral report is a partner coming back to the product, not a
 * stranger discovering it, and averaging the two answers neither question.
 */
function sailoHref(): string {
  const url = new URL("/", APP_URL);
  url.searchParams.set("utm_source", "sailo");
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", "transactional_footer");
  return url.toString();
}

export function sailoLayout(heading: string, body: string) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a20;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e6ea;border-radius:16px;">
    <tr><td style="padding:28px;">
      <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3;">${esc(heading)}</h1>
      ${body}
    </td></tr>
  </table>
  <p style="${FOOTER}">
    <a href="${esc(sailoHref())}" style="${FOOTER_LINK}">Sailo</a>
  </p>
</body></html>`;
}

export function button(href: string, label: string) {
  return `<a href="${esc(href)}" style="display:inline-block;margin-top:20px;padding:11px 20px;background:#1a1a20;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">${esc(label)}</a>`;
}
