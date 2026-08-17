/**
 * The skeletons every email hangs from.
 *
 * Two of them, and the difference is who sent the mail: a shop's receipt carries the shop's
 * name and logo, and Sailo's own mail carries the mark. The marketing footer's two extra
 * lines are law rather than decoration, and each fails in a different direction, which is
 * why they live with the layout that renders them.
 */

import type { Shop } from "@sailo/db/schema";
import { badgeHref, showsBadge } from "@sailo/core/badge";
import { isRenderableImageUrl } from "@sailo/storage/urls";
import { LEGAL } from "@sailo/core/legal";
import { appOrigin } from "@sailo/core/origin";
import { esc } from "./escape";
import {
  BORDER,
  BRAND_GREEN,
  CANVAS,
  FAINT,
  FONT,
  FOOTER,
  FOOTER_LINK,
  HAIRLINE,
  INK,
  MUTED,
  SAILO_MARK_SRC,
} from "./palette";

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
    ? `Sent by ${esc(shop.name)} via <a href="${esc(badgeHref(shop.handle, appOrigin(), "email"))}" style="${FOOTER_LINK}">Sailo</a> — open your own shop, free`
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
  const url = new URL("/", appOrigin());
  url.searchParams.set("utm_source", "sailo");
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", "transactional_footer");
  return url.toString();
}

/**
 * The two extra lines a marketing email carries and a transactional one must
 * not.
 *
 * Both are law rather than decoration, and each fails in a different
 * direction. The postal address is CAN-SPAM's flat requirement on any
 * commercial message — it is the sender being findable, and there is no
 * version of "we'd rather not" — so it comes from `LEGAL`, the same single
 * source the privacy policy and the terms are built from, and not from a
 * string typed here that could go out of date on its own.
 *
 * The unsubscribe line is the one people actually use, and its wording does
 * as much work as its presence: somebody who wants the tips to stop but has
 * an order arriving needs to know, *before* they click, that the two are
 * different. Told that, they unsubscribe. Not told, a good share of them
 * press "report spam" instead, which is the outcome this whole footer exists
 * to avoid.
 */
function marketingFooter(unsubscribeUrl: string) {
  const postal = `${LEGAL.operator} · ${LEGAL.street}, ${LEGAL.city}, ${LEGAL.state} ${LEGAL.postalCode}, ${LEGAL.country}`;
  return `
    <a href="${esc(sailoHref())}" style="${FOOTER_LINK}">Sailo</a><br />
    <span style="display:inline-block;margin-top:8px;">${esc(postal)}</span><br />
    <span style="display:inline-block;margin-top:8px;">
      You're getting this because you opened a Sailo account.
      <a href="${esc(unsubscribeUrl)}" style="${FOOTER_LINK}">Unsubscribe from tips</a> —
      order, billing and account emails are separate and keep arriving.
    </span>`;
}

/**
 * The shell for mail Sailo sends as itself — the mark and wordmark where a
 * shop's identity would sit, because no shop is involved. `layout` is the
 * other one: a shop talking to its buyer.
 *
 * `unsubscribeUrl` is what separates the two kinds of mail Sailo sends under
 * its own name. A password reset must not offer to unsubscribe from password
 * resets, so the line only appears when a caller passes a link — and the
 * marketing senders are the only callers that do, because the send pass
 * refuses to run at all without a signing secret to build one from.
 */
export function sailoLayout(
  heading: string,
  body: string,
  opts: { preheader?: string; unsubscribeUrl?: string } = {},
) {
  return shell({
    preheader: opts.preheader,
    accent: BRAND_GREEN,
    header: sailoHeader(),
    heading,
    body,
    footer: opts.unsubscribeUrl
      ? marketingFooter(opts.unsubscribeUrl)
      : `<a href="${esc(sailoHref())}" style="${FOOTER_LINK}">Sailo</a>`,
  });
}
