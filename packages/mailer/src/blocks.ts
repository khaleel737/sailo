/**
 * The pieces a message is assembled from.
 *
 * Paragraphs, sections, item rows, money rows, buttons. Every one takes already-escaped
 * HTML or escapes it itself, and none of them knows what message it is in — which is what
 * lets a receipt and a broadcast share them.
 */

import type { Order } from "@sailo/db/schema";
import { isRenderableImageUrl } from "@sailo/storage/urls";
import { formatMoney } from "@sailo/core/currency";
import { esc } from "./escape";
import { BORDER, FAINT, FONT, HAIRLINE, INK, MUTED, WELL } from "./palette";

/* --------------------------------------------------------------------------
   The pieces a message is assembled from
-------------------------------------------------------------------------- */

/** A body paragraph. `html`: caller has already escaped every value in it. */
export function para(html: string) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">${html}</p>`;
}

/** A quieter paragraph, for context rather than the point. Same contract. */
export function mutedPara(html: string) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${MUTED};">${html}</p>`;
}

/** Fine print. Same contract: already-safe HTML in, so links can live here. */
export function fine(html: string) {
  return `<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:${FAINT};">${html}</p>`;
}

/**
 * A labelled block — the unit every message is organised in. The label is the
 * categorisation itself: "Order summary", "Payment", "Delivery". Escaped here.
 * `inner` is already-safe HTML.
 */
export function section(label: string, inner: string) {
  return `<div style="margin-top:24px;">
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${FAINT};">${esc(label)}</p>
    ${inner}
  </div>`;
}

/**
 * Longer text someone typed — a buyer's note, a support message. Boxed so it
 * reads as quoted rather than as the email speaking. `pre-wrap` keeps their
 * line breaks. Escaped here.
 */
export function well(text: string) {
  return `<div style="padding:14px;background:${WELL};border-radius:10px;font-size:14px;line-height:1.6;color:${INK};white-space:pre-wrap;">${esc(text)}</div>`;
}

export type Detail = {
  label: string;
  value: string;
  /** Makes the value a link. */
  href?: string;
};

/**
 * Label/value rows — what "Carrier: DHL" looks like when it grows up.
 * Rows with empty values drop out, so callers can list everything an order
 * *might* carry and only what it does carry prints. Escaped here.
 */
export function detailTable(details: Detail[]) {
  const rows = details
    .filter((d) => d.value)
    .map((d) => {
      const value = d.href
        ? `<a href="${esc(d.href)}" style="color:${INK};font-weight:600;text-decoration:underline;">${esc(d.value)}</a>`
        : esc(d.value);
      return `<tr>
      <td style="padding:3px 16px 3px 0;font-size:14px;line-height:1.6;color:${MUTED};white-space:nowrap;vertical-align:top;">${esc(d.label)}</td>
      <td style="padding:3px 0;font-size:14px;line-height:1.6;color:${INK};vertical-align:top;width:100%;">${value}</td>
    </tr>`;
    })
    .join("");
  if (!rows) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>`;
}

/** The slice of an order line an email needs. `OrderLine` satisfies it. */
export type EmailOrderItem = {
  title: string;
  variantLabel: string | null;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  imageUrl: string | null;
  scheduledFor: Date | null;
  serviceMode: string | null;
  serviceLocation: string | null;
};

/**
 * A moment in time, written for a human.
 *
 * Always in the shop's zone when one is given: an appointment is a time to
 * turn up somewhere, and the seller's clock is the one both parties have to
 * agree on. The year is always present — a booking made in December for
 * January reads as next week without it. A malformed stored zone falls back
 * to the server's rather than failing the email that carries it.
 */
export function formatWhen(
  date: Date,
  timeZone: string | undefined,
  style: "short" | "long" = "short",
) {
  const shape =
    style === "long"
      ? ({ weekday: "long", day: "numeric", month: "long" } as const)
      : ({ weekday: "short", day: "numeric", month: "short" } as const);
  const options = {
    ...shape,
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  } as const;
  try {
    return date.toLocaleString("en-US", { ...options, timeZone });
  } catch {
    return date.toLocaleString("en-US", options);
  }
}

/**
 * The lines of an order, as a receipt shows them: what, how many, at what
 * price, adding to what — with the product's own picture where it has one the
 * platform trusts (the same allowlist as the shop logo, for the same reason).
 */
export function itemRows(
  items: EmailOrderItem[],
  currency: string,
  timeZone?: string,
) {
  /*
   * All rows carry the thumbnail column or none do. A table where some rows
   * have three cells and some two doesn't line anything up with anything.
   */
  const thumbs = items.some((i) => isRenderableImageUrl(i.imageUrl));

  const rows = items
    .map((item, i) => {
      const divider = i > 0 ? `border-top:1px solid ${HAIRLINE};` : "";

      const thumb = !thumbs
        ? ""
        : isRenderableImageUrl(item.imageUrl)
          ? `<td style="${divider}padding:10px 12px 10px 0;vertical-align:top;width:44px;"><img src="${esc(item.imageUrl)}" alt="" width="44" height="44" style="display:block;width:44px;height:44px;border-radius:8px;border:1px solid ${HAIRLINE};object-fit:cover;" /></td>`
          : `<td style="${divider}padding:10px 12px 10px 0;vertical-align:top;width:44px;"><div style="width:44px;height:44px;border-radius:8px;background:${WELL};font-size:16px;font-weight:600;color:${MUTED};text-align:center;line-height:44px;">${esc(item.title.trim().charAt(0).toUpperCase() || "•")}</div></td>`;

      const quantityLine =
        item.quantity > 1
          ? `<p style="margin:2px 0 0;font-size:13px;line-height:1.5;color:${FAINT};">${item.quantity} × ${esc(formatMoney(item.unitPriceCents, currency))}</p>`
          : "";

      const slotLine = item.scheduledFor
        ? `<p style="margin:2px 0 0;font-size:13px;line-height:1.5;color:${MUTED};">${esc(formatWhen(item.scheduledFor, timeZone))}</p>`
        : "";

      // A cart can book two services in two places; each line says where.
      const whereLine = item.serviceLocation
        ? `<p style="margin:2px 0 0;font-size:13px;line-height:1.5;color:${MUTED};">${item.serviceMode === "online" ? "Online — " : ""}${esc(item.serviceLocation)}</p>`
        : "";

      return `<tr>
      ${thumb}
      <td style="${divider}padding:10px 12px 10px 0;vertical-align:top;width:100%;">
        <p style="margin:0;font-size:15px;line-height:1.5;font-weight:600;color:${INK};">${esc(item.title)}</p>
        ${item.variantLabel ? `<p style="margin:2px 0 0;font-size:13px;line-height:1.5;color:${MUTED};">${esc(item.variantLabel)}</p>` : ""}
        ${quantityLine}
        ${slotLine}
        ${whereLine}
      </td>
      <td style="${divider}padding:10px 0;vertical-align:top;text-align:right;white-space:nowrap;font-size:14px;color:${INK};">${esc(formatMoney(item.subtotalCents, currency))}</td>
    </tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

/**
 * The money, in full. This is the one place a buyer sees the arithmetic, and
 * it shows every part the order actually has: the tax line was snapshotted
 * onto every order and then never shown to the person who paid it.
 */
export function moneyRows(order: Order) {
  const row = (label: string, value: string, bold = false) =>
    `<tr>
      <td style="padding:4px 0;font-size:14px;color:${MUTED};${bold ? `font-weight:600;color:${INK};border-top:1px solid ${HAIRLINE};padding-top:8px;` : ""}">${esc(label)}</td>
      <td style="padding:4px 0;font-size:14px;text-align:right;${bold ? `font-weight:600;border-top:1px solid ${HAIRLINE};padding-top:8px;` : ""}">${esc(value)}</td>
    </tr>`;

  const taxName = order.taxName?.trim() || "Tax";
  const taxRate =
    order.taxRateBp > 0 ? ` (${(order.taxRateBp / 100).toString()}%)` : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid ${HAIRLINE};padding-top:8px;">
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
    ${
      order.taxCents > 0 && !order.taxInclusive
        ? row(`${taxName}${taxRate}`, formatMoney(order.taxCents, order.currency))
        : ""
    }
    ${row("Total", formatMoney(order.totalCents, order.currency), true)}
    ${
      order.taxCents > 0 && order.taxInclusive
        ? `<tr><td colspan="2" style="padding:2px 0 0;font-size:13px;text-align:right;color:${FAINT};">Includes ${esc(`${taxName}${taxRate}`)} of ${esc(formatMoney(order.taxCents, order.currency))}</td></tr>`
        : ""
    }
  </table>`;
}

/**
 * The one thing this email wants pressed. Wrapped in its own table because a
 * padded anchor alone loses its padding in older Outlooks; the table keeps the
 * whole pill pressable at a finger-sized 45px.
 */
export function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td style="background:${INK};border-radius:10px;">
    <a href="${esc(href)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a>
  </td></tr></table>`;
}

/**
 * The second-place action — view the invoice while the download button is the
 * point. Outlined so the hierarchy survives even in a client that drops half
 * the styling: one solid thing, one hollow thing.
 */
export function buttonGhost(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;"><tr><td style="border:1px solid ${BORDER};border-radius:10px;">
    <a href="${esc(href)}" style="display:inline-block;padding:11px 23px;font-family:${FONT};font-size:15px;font-weight:600;color:${INK};text-decoration:none;">${esc(label)}</a>
  </td></tr></table>`;
}

/** An in-body link. Underlined: an email has no hover to say "press me". */
export function link(href: string, label: string) {
  return `<a href="${esc(href)}" style="color:${INK};font-weight:600;text-decoration:underline;">${esc(label)}</a>`;
}

/** Emphasis that keeps its ink inside a muted paragraph. Escaped here. */
export function strong(text: string) {
  return `<strong style="color:${INK};">${esc(text)}</strong>`;
}
