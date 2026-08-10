import { marked } from "marked";
import { esc, fine, layout } from "@/lib/email/markup";
import type { Shop } from "@/db/schema";

/**
 * Turning what the seller wrote into an email.
 *
 * The body goes through the same `layout` every transactional message uses,
 * so a broadcast inherits the shop's accent, the dark-mode handling and the
 * table-based markup that Outlook survives — rather than being a second
 * rendering path that has to relearn all of it.
 *
 * Markdown, not HTML. A seller pasting HTML into a field that renders it is
 * a stored-XSS hole in every inbox that opens it, and more prosaically it is
 * how a stray unclosed tag swallows the unsubscribe line. `marked` produces
 * a bounded set of tags from text, which is the whole point of choosing it.
 */

/**
 * Tags a marketing email is allowed to contain.
 *
 * An allowlist over the rendered output rather than trust in the renderer:
 * `marked` passes raw HTML through by default, so a body containing
 * `<script>` or an `onclick` attribute would arrive intact. Stripping after
 * rendering catches both that and anything a future renderer upgrade decides
 * to start emitting.
 */
const ALLOWED = new Set([
  "p", "br", "strong", "em", "b", "i", "u", "s", "del",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4",
  "a", "hr", "code", "pre",
]);

function sanitize(html: string): string {
  return (
    html
      // Whole elements whose *content* is the danger, not just the tag.
      .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]+>/g, (tag) => {
        const name = /^<\/?\s*([a-zA-Z0-9]+)/.exec(tag)?.[1]?.toLowerCase();
        if (!name || !ALLOWED.has(name)) return "";
        if (name !== "a") {
          // Every other tag keeps its name and loses every attribute, so
          // `onerror`, `style` and `srcset` have nowhere to live.
          return tag.startsWith("</") ? `</${name}>` : `<${name}>`;
        }
        if (tag.startsWith("</")) return "</a>";
        /*
         * A link keeps its href and nothing else, and only if the href is
         * one a mail client should follow. `javascript:` in an email is
         * mostly inert, but `data:` is not — it is a way to serve a page
         * from inside the message — and neither has a legitimate use here.
         */
        const href = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
        const url = (href?.[2] ?? href?.[3] ?? href?.[4] ?? "").trim();
        return /^(https?:\/\/|mailto:)/i.test(url)
          ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">`
          : "<a>";
      })
  );
}

/** The seller's body, rendered and cleaned. */
export function renderBody(markdown: string): string {
  const html = marked.parse(markdown, { async: false, breaks: true, gfm: true });
  return sanitize(typeof html === "string" ? html : "");
}

/**
 * The plain-text part.
 *
 * Generated rather than omitted. A bulk HTML-only message scores worse with
 * every spam filter there is, and the text part is also what a watch and a
 * screen reader read first. Derived from the markdown rather than from the
 * HTML, because markdown *is* the plain-text version — that is what it is for.
 */
export function renderText(markdown: string, unsubscribeUrl: string): string {
  const body = markdown
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`>]/g, "")
    .trim();

  return `${body}\n\n—\nUnsubscribe: ${unsubscribeUrl}`;
}

/**
 * One recipient's full message body, including the line the law requires.
 *
 * The unsubscribe line is appended here rather than left to the seller,
 * because a seller who forgets it is a seller who has sent unlawful mail
 * through our domain. It is not optional, not configurable, and not part of
 * what they compose.
 */
export function renderBroadcast(opts: {
  shop: Shop;
  subject: string;
  bodyMarkdown: string;
  unsubscribeUrl: string;
  /** Where the shop lives, so the message identifies its sender. */
  senderLine: string;
  /** "Unsubscribe" in the shop's own language. */
  unsubscribeLabel: string;
}): string {
  const body = `
    ${renderBody(opts.bodyMarkdown)}
    ${fine(
      `${esc(opts.senderLine)}<br><a href="${esc(opts.unsubscribeUrl)}" style="color:#6b6b78;text-decoration:underline;">${esc(opts.unsubscribeLabel)}</a>`,
    )}
  `;

  return layout(opts.shop, opts.subject, body, {
    preheader: opts.subject,
  });
}
