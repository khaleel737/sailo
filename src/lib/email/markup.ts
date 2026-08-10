import type { Order, Shop } from "@/db/schema";
import { badgeHref, showsBadge } from "@/components/shared/powered-by";
import { isRenderableImageUrl } from "@/lib/file-urls";
import { APP_URL, absolute } from "@/lib/seo";
import { formatMoney } from "@/lib/utils";

/**
 * The HTML an email is built from.
 *
 * Email clients are the one rendering target that never updates: no external
 * CSS, no flexbox in Outlook, no SVG in Gmail. Everything here is therefore
 * tables, inline styles and hosted PNGs — the 1999 toolkit, used on purpose.
 *
 * Every value that reaches the markup goes through `esc` first. An order
 * carries text the buyer typed — their name, their note — and a shop carries
 * text its owner typed, so both are someone else's input by the time they
 * arrive here. Helpers that accept `html` parameters expect the caller to have
 * escaped every interpolated value already; helpers that accept plain strings
 * escape them themselves. Each one says which it is.
 */

export const esc = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* --------------------------------------------------------------------------
   Palette

   The app's own inks, with one substitution. The app's faint grey #8e8e9c
   reads at 3.2:1 on white — under the 4.5:1 floor small text needs — so email
   fine print uses #6b6b78 instead: the same grey the footer already had to
   adopt for exactly this reason, at 4.9:1. Nothing in an email may be lighter.
-------------------------------------------------------------------------- */

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const INK = "#1a1a20";
const MUTED = "#565664";
const FAINT = "#6b6b78";
const BORDER = "#e6e6ea";
const HAIRLINE = "#ededf0";
const CANVAS = "#f7f7f8";
const WELL = "#f6f6f8";
/** The leaf's green — Sailo's own mail wears it; a shop's mail wears its own accent. */
const BRAND_GREEN = "#037740";

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

/**
 * The Sailo mark, as a hosted PNG. Gmail strips SVG, so the email build of the
 * logo is a raster export of the same leaf — 112px for a 28px slot, which
 * keeps it crisp on a 4× phone screen at under 3KB.
 */
const SAILO_MARK_SRC = absolute("/brand/email/sailo-mark.png");

/**
 * A seller-typed accent colour ends up inside a style attribute, where `esc`
 * stops attribute breakout but not CSS of the seller's choosing. Only a bare
 * hex value survives; anything else falls back to ink.
 */
function safeAccent(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : INK;
}

/**
 * The line an inbox shows under the subject.
 *
 * Without one, clients pull the first text they find — the heading, which the
 * subject already said, or worse the footer. Hidden from the opened email;
 * the trailing padding keeps clients from appending body text after it.
 */
function preheaderHtml(text: string) {
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(text)}${"&nbsp;&zwnj;".repeat(80)}</div>`;
}

/**
 * The one skeleton every email hangs from, so a shop's receipt and Sailo's own
 * mail cannot drift apart. The two layouts below differ only in what they put
 * in the header, the accent and the footer.
 */
function shell(opts: {
  preheader?: string;
  accent: string;
  /** The identity row — already-safe HTML. */
  header: string;
  heading: string;
  /** Already-safe HTML. */
  body: string;
  /** Optional already-safe HTML under a hairline at the card's foot. */
  help?: string;
  /** Already-safe HTML inside the footer paragraph. */
  footer: string;
}) {
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px 12px;background:${CANVAS};font-family:${FONT};color:${INK};">
  ${opts.preheader ? preheaderHtml(opts.preheader) : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;">
    <tr><td style="height:4px;background:${opts.accent};border-radius:15px 15px 0 0;font-size:0;line-height:4px;">&nbsp;</td></tr>
    <tr><td style="padding:24px 28px 0;">${opts.header}</td></tr>
    <tr><td style="padding:14px 28px 0;"><h1 style="margin:0;font-size:21px;line-height:1.3;font-weight:600;">${esc(opts.heading)}</h1></td></tr>
    <tr><td style="padding:16px 28px ${opts.help ? "24px" : "28px"};">${opts.body}</td></tr>
    ${
      opts.help
        ? `<tr><td style="padding:16px 28px 20px;border-top:1px solid ${HAIRLINE};">${opts.help}</td></tr>`
        : ""
    }
  </table>
  <p style="${FOOTER}">
    ${opts.footer}
  </p>
</body></html>`;
}

/**
 * The shop's name, with its logo when it has one the platform trusts.
 *
 * `isRenderableImageUrl` is the same allowlist the storefront and the OG
 * routes enforce, and it matters more here: a page is covered by the CSP, but
 * an email is rendered by whatever client opens it, so an unchecked URL in a
 * stored row would fetch from a buyer's inbox with no policy in the way.
 */
function shopHeader(shop: Shop) {
  const name = `<span style="font-size:14px;font-weight:600;color:${MUTED};">${esc(shop.name)}</span>`;
  const logo = [shop.logoUrl, shop.avatarUrl].find(isRenderableImageUrl);
  if (!logo) return name;

  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:10px;"><img src="${esc(logo)}" alt="" width="36" height="36" style="display:block;width:36px;height:36px;border-radius:8px;border:0;object-fit:cover;" /></td>
    <td style="font-family:${FONT};">${name}</td>
  </tr></table>`;
}

/** The mark beside the wordmark. Alt text stays empty: "Sailo" is right there. */
function sailoHeader() {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:8px;"><img src="${esc(SAILO_MARK_SRC)}" alt="" width="28" height="28" style="display:block;width:28px;height:28px;border:0;" /></td>
    <td style="font-family:${FONT};font-size:17px;font-weight:700;color:${INK};">Sailo</td>
  </tr></table>`;
}

/** The shell for a shop talking to its buyer. */
export function layout(
  shop: Shop,
  heading: string,
  body: string,
  opts: { preheader?: string } = {},
) {
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

  /*
   * Every order email sets replyTo to the shop's contact address — when it has
   * one. Without one a reply lands in Sailo's sending inbox and dies there, so
   * the invitation to reply only appears when a reply actually goes somewhere.
   */
  const help = shop.contactEmail
    ? `<p style="margin:0;font-size:13px;line-height:1.5;color:${FAINT};">Questions? Just reply to this email — it goes straight to ${esc(shop.name)}.</p>`
    : "";

  return shell({
    preheader: opts.preheader,
    accent: safeAccent(shop.accentColor),
    header: shopHeader(shop),
    heading,
    body,
    help,
    footer,
  });
}

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

/**
 * The shell for mail Sailo sends as itself — the mark and wordmark where a
 * shop's identity would sit, because no shop is involved. `layout` is the
 * other one: a shop talking to its buyer.
 */
export function sailoLayout(
  heading: string,
  body: string,
  opts: { preheader?: string } = {},
) {
  return shell({
    preheader: opts.preheader,
    accent: BRAND_GREEN,
    header: sailoHeader(),
    heading,
    body,
    footer: `<a href="${esc(sailoHref())}" style="${FOOTER_LINK}">Sailo</a>`,
  });
}

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
