import { esc, fine, layout } from "@/lib/email/markup";
import { isRenderableImageUrl } from "@/lib/file-urls";
import { formatMoney } from "@/lib/utils";
import type { Shop } from "@sailo/db/schema";
import {
  applyMergeTags,
  renderBody,
  toPlainText,
  type MergeValues,
} from "./markdown";

/**
 * Turning what the seller wrote into an email.
 *
 * The body goes through the same `layout` every transactional message uses,
 * so a broadcast inherits the shop's accent, the dark-mode handling and the
 * table-based markup that Outlook survives — rather than being a second
 * rendering path that has to relearn all of it. What this file adds on top is
 * the part a marketing message has and a receipt does not: an offer, the
 * things the offer is for, and one button.
 *
 * The rendering itself lives in `./markdown`, which has no server imports, so
 * the composer's preview pane and the send path produce the same bytes.
 */

/* --------------------------------------------------------------------------
   The promotion
-------------------------------------------------------------------------- */

/** A coupon, as the email needs it — resolved at send time, never snapshotted. */
export type PromoCoupon = {
  code: string;
  /** percent | fixed */
  discountType: string;
  /** Basis points when percent, minor units when fixed. */
  discountValue: number;
  minSubtotalCents: number;
  expiresAt: Date | null;
};

/** One product card. Prices are already resolved; the URL is absolute. */
export type PromoProduct = {
  title: string;
  priceCents: number;
  compareAtCents: number | null;
  imageUrl: string | null;
  url: string;
};

/** The words this email's chrome wears, in the shop's own language. */
export type BroadcastLabels = {
  unsubscribe: string;
  /** "20% off" — the headline of the coupon block. */
  amountOff: string;
  /** "Use code {code}" — how the plain-text part says the same thing. */
  useCode: string;
  endsOn: string;
  minSpend: string;
  shopNow: string;
  /** What `{{first_name}}` says when there is no name. */
  friend: string;
};

const INK = "#1a1a20";
const MUTED = "#565664";
const BORDER = "#e6e6ea";
const WELL = "#f6f6f8";

/**
 * The discount, as the one thing in the message that cannot be missed.
 *
 * A dashed border and a monospace code, because the two things a person does
 * with a coupon in an email are read it aloud and copy it, and both are
 * harder in the body typeface. The conditions sit under it rather than in the
 * seller's prose: a code whose expiry is only mentioned in a paragraph the
 * recipient skimmed is a support conversation on the day it stops working.
 */
function couponBlock(coupon: PromoCoupon, shop: Shop, labels: BroadcastLabels): string {
  const amount =
    coupon.discountType === "percent"
      ? `${(coupon.discountValue / 100).toFixed(coupon.discountValue % 100 === 0 ? 0 : 1)}%`
      : formatMoney(coupon.discountValue, shop.currency);

  const conditions = [
    coupon.expiresAt
      ? labels.endsOn.replace(
          "{date}",
          coupon.expiresAt.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        )
      : "",
    coupon.minSubtotalCents > 0
      ? labels.minSpend.replace("{amount}", formatMoney(coupon.minSubtotalCents, shop.currency))
      : "",
  ].filter(Boolean);

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
      <tr><td style="padding:18px;background:${WELL};border:1px dashed ${BORDER};border-radius:12px;text-align:center;">
        <p style="margin:0 0 6px;font-size:13px;color:${MUTED};">${esc(
          labels.amountOff.replace("{amount}", amount),
        )}</p>
        <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:700;letter-spacing:0.08em;color:${INK};">${esc(
          coupon.code,
        )}</p>
        ${
          conditions.length > 0
            ? `<p style="margin:8px 0 0;font-size:12px;color:#6b6b78;">${esc(conditions.join(" · "))}</p>`
            : ""
        }
      </td></tr>
    </table>`;
}

/**
 * The products, as rows rather than a grid.
 *
 * A two-column grid is where email rendering goes wrong: Outlook ignores
 * floats, Gmail's mobile app collapses widths unpredictably, and the result
 * on the client with the largest share of opens is a squashed column of
 * cropped photos. One product per row is the shape that survives everywhere,
 * and it reads better at a phone width regardless.
 */
function productRows(items: PromoProduct[], shop: Shop): string {
  if (items.length === 0) return "";

  const rows = items
    .map((item) => {
      const image = isRenderableImageUrl(item.imageUrl)
        ? `<td width="72" style="padding-right:14px;vertical-align:top;">
             <a href="${esc(item.url)}"><img src="${esc(item.imageUrl ?? "")}" alt="" width="72" height="72" style="display:block;width:72px;height:72px;border-radius:10px;border:0;object-fit:cover;" /></a>
           </td>`
        : "";

      const wasPrice =
        item.compareAtCents && item.compareAtCents > item.priceCents
          ? ` <span style="color:#6b6b78;text-decoration:line-through;font-weight:400;">${esc(
              formatMoney(item.compareAtCents, shop.currency),
            )}</span>`
          : "";

      return `<tr><td style="padding:12px 0;border-top:1px solid ${BORDER};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${image}
          <td style="vertical-align:top;">
            <a href="${esc(item.url)}" style="font-size:15px;font-weight:600;color:${INK};text-decoration:none;">${esc(item.title)}</a>
            <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:${INK};">${esc(
              formatMoney(item.priceCents, shop.currency),
            )}${wasPrice}</p>
          </td>
        </tr></table>
      </td></tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">${rows}</table>`;
}

/**
 * One button, and it is a table.
 *
 * A styled `<a>` is a button everywhere except Outlook, which is where a
 * quarter of a seller's list reads their mail. The bulletproof shape — a
 * one-cell table with the background on the cell and the padding on the link
 * — is ugly to write once here and correct in every client.
 */
function ctaButton(label: string, url: string, accent: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">
      <tr><td style="background:${esc(accent)};border-radius:10px;">
        <a href="${esc(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a>
      </td></tr>
    </table>`;
}

/** A seller-typed accent ends up in a style attribute; only a bare hex survives. */
function safeAccent(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : INK;
}

/* --------------------------------------------------------------------------
   The message
-------------------------------------------------------------------------- */

export type BroadcastContent = {
  subject: string;
  previewText: string | null;
  bodyMarkdown: string;
  coupon: PromoCoupon | null;
  products: PromoProduct[];
  cta: { label: string; url: string } | null;
};

/**
 * One recipient's full message, including the line the law requires.
 *
 * The unsubscribe line is appended here rather than left to the seller,
 * because a seller who forgets it is a seller who has sent unlawful mail
 * through our domain. It is not optional, not configurable, and not part of
 * what they compose.
 *
 * Order matters and is not the seller's to choose: body, then offer, then
 * what the offer is for, then the button. A discount code above the sentence
 * explaining it is a code nobody uses, and a button above the products is a
 * button pressed by people who have not seen them yet.
 */
export function renderBroadcast(opts: {
  shop: Shop;
  content: BroadcastContent;
  unsubscribeUrl: string;
  /** Where the shop lives, so the message identifies its sender. */
  senderLine: string;
  labels: BroadcastLabels;
  merge: MergeValues;
}): string {
  const { content, labels } = opts;

  const body = `
    ${applyMergeTags(renderBody(content.bodyMarkdown), opts.merge)}
    ${content.coupon ? couponBlock(content.coupon, opts.shop, labels) : ""}
    ${productRows(content.products, opts.shop)}
    ${
      content.cta
        ? ctaButton(content.cta.label, content.cta.url, safeAccent(opts.shop.accentColor))
        : ""
    }
    ${fine(
      `${esc(opts.senderLine)}<br><a href="${esc(opts.unsubscribeUrl)}" style="color:#6b6b78;text-decoration:underline;">${esc(labels.unsubscribe)}</a>`,
    )}
  `;

  return layout(opts.shop, applyMergeTags(content.subject, opts.merge, false), body, {
    // Blank falls back to the subject, which is what an inbox would have
    // pulled anyway — but a seller who wrote a preview line gets theirs.
    preheader: applyMergeTags(content.previewText || content.subject, opts.merge, false),
  });
}

/**
 * The plain-text part.
 *
 * It carries the offer too. A text-only client showing the message without
 * the code is showing a discount announcement with no discount in it, and
 * "see the HTML version" is not something a recipient can act on.
 */
export function renderText(opts: {
  content: BroadcastContent;
  unsubscribeUrl: string;
  labels: BroadcastLabels;
  merge: MergeValues;
  currency: string;
}): string {
  const parts = [applyMergeTags(toPlainText(opts.content.bodyMarkdown), opts.merge, false)];

  if (opts.content.coupon) {
    parts.push(opts.labels.useCode.replace("{code}", opts.content.coupon.code));
  }
  for (const product of opts.content.products) {
    parts.push(`${product.title} — ${formatMoney(product.priceCents, opts.currency)}\n${product.url}`);
  }
  if (opts.content.cta) {
    parts.push(`${opts.content.cta.label}: ${opts.content.cta.url}`);
  }

  parts.push(`—\n${opts.labels.unsubscribe}: ${opts.unsubscribeUrl}`);
  return parts.join("\n\n");
}
