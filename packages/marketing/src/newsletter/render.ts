import { button, sailoLayout } from "@sailo/mailer/markup";
import { renderBody, toPlainText } from "../broadcasts/markdown";

/**
 * A campaign, turned into the email that lands.
 *
 * The body goes through the *same* markdown renderer a shop's broadcast uses,
 * and that is a deliberate reuse rather than a convenience. That module has an
 * allowlist over the rendered output, per-tag inline styles because Gmail
 * strips `<style>` blocks, and URL schemes checked on every link and image. A
 * second renderer here would be a second place to get all of that right, and
 * the one that is used less often is the one that is wrong.
 *
 * What differs is the skeleton around it: `sailoLayout` rather than `layout`,
 * because this mail is from Sailo and there is no shop whose logo and accent
 * belong at the top of it.
 */

export type NewsletterContent = {
  subject: string;
  previewText: string | null;
  bodyMarkdown: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

/**
 * The preheader an inbox shows under the subject.
 *
 * Falls back to the first line of the body rather than to the subject. A
 * preheader that repeats the subject wastes the one piece of copy that decides
 * whether a marketing email is opened at all, and an empty one lets the client
 * pull whatever text it finds first — which, in a message with a button near
 * the top, is often the word "Unsubscribe".
 */
function preheaderFor(content: NewsletterContent): string {
  if (content.previewText?.trim()) return content.previewText.trim();
  const firstLine = toPlainText(content.bodyMarkdown).split("\n")[0] ?? "";
  return firstLine.slice(0, 140);
}

/**
 * The campaign as HTML.
 *
 * `unsubscribeUrl` is required and not optional. Every path into this function
 * is bulk marketing mail, and a signature that lets a caller omit the link is a
 * signature that will eventually be called without it — the type is the check
 * that stops the send rather than a comment asking politely.
 */
export function renderNewsletter(opts: {
  content: NewsletterContent;
  unsubscribeUrl: string;
}): string {
  const { content } = opts;

  const cta =
    content.ctaUrl && content.ctaLabel
      ? button(content.ctaUrl, content.ctaLabel)
      : "";

  return sailoLayout(content.subject, `${renderBody(content.bodyMarkdown)}${cta}`, {
    preheader: preheaderFor(content),
    unsubscribeUrl: opts.unsubscribeUrl,
  });
}

/**
 * The plain-text alternative.
 *
 * Generated rather than omitted: a bulk HTML-only message scores worse with
 * every spam filter there is, and the text part is also what a watch and a
 * screen reader read first. Derived from the markdown rather than from the
 * HTML, because markdown *is* the plain-text version — that is what it is for.
 */
export function renderNewsletterText(opts: {
  content: NewsletterContent;
  unsubscribeUrl: string;
  unsubscribeLabel: string;
}): string {
  const { content } = opts;
  const parts = [toPlainText(content.bodyMarkdown)];
  if (content.ctaUrl && content.ctaLabel) {
    parts.push(`${content.ctaLabel}: ${content.ctaUrl}`);
  }
  parts.push(`${opts.unsubscribeLabel}: ${opts.unsubscribeUrl}`);
  return parts.join("\n\n");
}

/**
 * The composer's preview pane, which is the *body* and not the whole email.
 *
 * Deliberately not `renderNewsletter`. The preview runs in the browser, and
 * showing a full `<!doctype html>` document inside the page would either need
 * an iframe or would leak the email's own resets into the surrounding admin.
 * More importantly, the thing a writer is checking at that moment is their own
 * words — the chrome around them is the same on every campaign.
 *
 * It is the same `renderBody`, so what the preview shows is what the send
 * produces, which is the property that matters: a preview from a different
 * renderer is the thing that gets somebody to press Send on an email they have
 * not actually seen.
 */
export function previewNewsletterBody(markdown: string): string {
  return renderBody(markdown);
}
