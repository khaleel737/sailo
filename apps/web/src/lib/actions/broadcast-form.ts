/**
 * Reading a broadcast out of a form, the ceilings it respects, and naming why a send was
 * refused.
 *
 * WHY THIS IS NOT IN `broadcasts.ts`
 *
 * That file is `"use server"`, and a server module may export *only* async functions — so a
 * form reader living there can never be exported. That is why every ceiling and every reader
 * in it was a local that nothing outside could use or test, and why each action re-read the
 * form for itself.
 *
 * `safeUrl` is the one with teeth: a broadcast's link is typed by a seller and mailed to their
 * customers, so a `javascript:` URL here is a payload in somebody else's inbox.
 */

import { isUuid } from "@sailo/core/uuid";
import { MAX_PROMO_PRODUCTS } from "@sailo/marketing/broadcasts/server";
import { type Budget } from "@sailo/marketing/broadcasts/server";
import { parseSegment } from "@sailo/marketing/broadcasts";
import { LEGAL } from "@sailo/core/legal";


export const MAX_SUBJECT = 200;

export const MAX_PREVIEW = 160;

export const MAX_BODY = 20_000;

export const MAX_CTA_LABEL = 40;

/** A link a seller typed, or nothing. Rendered into every recipient's inbox. */
export function safeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The ids of products to feature, folded to what the schema will take. */
export function readProductIds(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(isUuid),
    ),
  ].slice(0, MAX_PROMO_PRODUCTS);
}

export function read(formData: FormData) {
  const couponId = String(formData.get("couponId") ?? "").trim();

  /*
   * The segment arrives as JSON from the builder and is parsed, not trusted.
   * `parseSegment` drops any rule it cannot make sense of, which is the safe
   * direction: an unparseable rule that survived would be a WHERE clause
   * nobody wrote.
   */
  let filter: unknown = null;
  try {
    const raw = String(formData.get("segment") ?? "");
    filter = raw ? JSON.parse(raw) : null;
  } catch {
    filter = null;
  }

  return {
    subject: String(formData.get("subject") ?? "").trim().slice(0, MAX_SUBJECT),
    previewText: String(formData.get("previewText") ?? "").trim().slice(0, MAX_PREVIEW) || null,
    bodyMarkdown: String(formData.get("body") ?? "").trim().slice(0, MAX_BODY),
    segment: parseSegment(filter),
    couponId: isUuid(couponId) ? couponId : null,
    productIds: readProductIds(String(formData.get("products") ?? "")),
    ctaLabel: String(formData.get("ctaLabel") ?? "").trim().slice(0, MAX_CTA_LABEL) || null,
    ctaUrl: safeUrl(String(formData.get("ctaUrl") ?? "")),
  };
}

/**
 * Why a send was refused, in words the seller can act on.
 *
 * Each ceiling gets its own sentence because each has a different answer, and
 * a generic "try later" is wrong for two of the four: waiting does nothing for
 * a reputation pause, and a warm-up is not something the seller has done
 * wrong. The pause deliberately does not print the internal reason string — it
 * says what happened and where to reply, because the conversation that follows
 * is with a person and not with this screen.
 */
export function refusal(limitedBy: Budget["limitedBy"]): string {
  switch (limitedBy) {
    case "paused":
      return `Marketing sending is paused on this shop: too many of your recent emails bounced or were reported as spam. Everything else — orders, receipts, your storefront — is unaffected. Email ${LEGAL.supportEmail} and we'll go through it with you.`;
    case "warmup":
      return "New shops send a smaller number of marketing emails each day for the first couple of weeks, so mailboxes learn to trust your address. You've reached today's — it lifts tomorrow, and the limit rises as you go.";
    case "platform":
      return "Sending is paused across Sailo for the next little while. Nothing is lost — try again shortly.";
    default:
      return "You've reached today's sending limit. It resets on a rolling 24 hours.";
  }
}
