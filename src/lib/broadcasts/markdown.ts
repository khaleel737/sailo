import { marked } from "marked";

/**
 * What a seller writes, turned into what an inbox renders.
 *
 * Deliberately free of every server import, because the composer's preview
 * pane runs this in the browser and the send path runs it on the server, and
 * a preview produced by a *different* renderer is not a preview. It is the
 * thing that gets a seller to press Send on an email they have not seen.
 *
 * Markdown rather than a rich-text field or raw HTML. Raw HTML from a seller
 * is stored XSS in every inbox that opens it; a WYSIWYG surface would need
 * its own sanitiser, its own paste handling and its own email-safe output,
 * which is three more places to be wrong about the same thing.
 */

/* --------------------------------------------------------------------------
   Escaping

   Local, and not the email module's `esc`, so this file can be imported by a
   client component without dragging the server-side email markup — and its
   transitive imports — into the browser bundle.
-------------------------------------------------------------------------- */

export const escapeHtml = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* --------------------------------------------------------------------------
   The allowlist

   An allowlist over the *rendered output*, rather than trust in the renderer:
   `marked` passes raw HTML through by default, so a body containing
   `<script>` or an `onclick` attribute would arrive intact. Stripping after
   rendering catches that and anything a future renderer upgrade decides to
   start emitting.
-------------------------------------------------------------------------- */

/**
 * Every tag that survives, and the inline style it wears.
 *
 * The styles are the reason this is a map and not a set. Email clients apply
 * no stylesheet of their own and Gmail strips `<style>` blocks outright, so a
 * bare `<p>` from the renderer arrived in a shape nothing had specified —
 * browser-default 16px Times in some clients, cramped line height in others,
 * and visibly not the type the rest of the message was set in. Every tag
 * therefore carries its own styling, inline, exactly as the transactional
 * templates' own helpers do.
 */
const STYLES: Record<string, string> = {
  p: "margin:0 0 16px;font-size:15px;line-height:1.6;color:#1a1a20;",
  h1: "margin:24px 0 12px;font-size:21px;line-height:1.3;font-weight:600;color:#1a1a20;",
  h2: "margin:24px 0 10px;font-size:18px;line-height:1.35;font-weight:600;color:#1a1a20;",
  h3: "margin:20px 0 8px;font-size:16px;line-height:1.4;font-weight:600;color:#1a1a20;",
  h4: "margin:20px 0 8px;font-size:15px;line-height:1.4;font-weight:600;color:#1a1a20;",
  ul: "margin:0 0 16px;padding-left:22px;font-size:15px;line-height:1.6;color:#1a1a20;",
  ol: "margin:0 0 16px;padding-left:22px;font-size:15px;line-height:1.6;color:#1a1a20;",
  li: "margin:0 0 6px;",
  blockquote:
    "margin:0 0 16px;padding:2px 0 2px 14px;border-left:3px solid #e6e6ea;color:#565664;font-size:15px;line-height:1.6;",
  hr: "border:0;border-top:1px solid #e6e6ea;margin:24px 0;",
  code: "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f6f6f8;padding:1px 5px;border-radius:5px;",
  pre: "margin:0 0 16px;padding:12px 14px;background:#f6f6f8;border-radius:10px;font-size:13px;line-height:1.5;overflow-x:auto;",
  strong: "font-weight:600;",
  b: "font-weight:600;",
  em: "font-style:italic;",
  i: "font-style:italic;",
  u: "text-decoration:underline;",
  s: "text-decoration:line-through;",
  del: "text-decoration:line-through;",
  br: "",
  a: "",
  img: "",
};

/**
 * A link's href, or nothing.
 *
 * `javascript:` in an email is mostly inert, but `data:` is not — it is a way
 * to serve a whole page from inside the message — and neither has a
 * legitimate use in a shop's newsletter.
 */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(url) ? url : null;
}

/**
 * An image's src, or nothing.
 *
 * Stricter than a link: `https` only, because a mail client fetching an image
 * over plain http from a message opened on a café network is a downgrade the
 * recipient did not choose, and several clients block it anyway — leaving a
 * seller looking at a broken picture with no explanation.
 */
function safeSrc(raw: string): string | null {
  const url = raw.trim();
  return /^https:\/\//i.test(url) ? url : null;
}

function attr(tag: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return (match?.[2] ?? match?.[3] ?? match?.[4] ?? "").trim();
}

/**
 * The rendered HTML, reduced to what is allowed and dressed for email.
 *
 * Every tag is rebuilt from its name rather than edited in place, so an
 * attribute nobody thought about — `onerror`, `srcset`, `style` carrying a
 * seller's own CSS — has nowhere to survive. Only `a` and `img` keep anything,
 * and only after their URL has been checked.
 */
function sanitize(html: string): string {
  return (
    html
      // Whole elements whose *content* is the danger, not just the tag.
      .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]+>/g, (tag) => {
        const name = /^<\/?\s*([a-zA-Z0-9]+)/.exec(tag)?.[1]?.toLowerCase();
        if (!name || !(name in STYLES)) return "";

        if (tag.startsWith("</")) return name === "img" || name === "br" ? "" : `</${name}>`;

        const style = STYLES[name] ? ` style="${STYLES[name]}"` : "";

        if (name === "a") {
          const href = safeHref(attr(tag, "href"));
          return href
            ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:#1a1a20;font-weight:600;text-decoration:underline;">`
            : "<a>";
        }

        if (name === "img") {
          const src = safeSrc(attr(tag, "src"));
          if (!src) return "";
          /*
           * Alt text is kept because most clients block images by default and
           * the alt is all the recipient sees until they unblock them. The
           * width cap is not decoration either: a 3000px photo in a 560px
           * card is a horizontal scrollbar in every mobile client there is.
           */
          const alt = escapeHtml(attr(tag, "alt"));
          return `<img src="${escapeHtml(src)}" alt="${alt}" style="display:block;max-width:100%;height:auto;margin:0 0 16px;border-radius:10px;border:0;" />`;
        }

        return `<${name}${style}>`;
      })
  );
}

/** The seller's body, rendered, cleaned and styled for an inbox. */
export function renderBody(markdown: string): string {
  const html = marked.parse(markdown, { async: false, breaks: true, gfm: true });
  return sanitize(typeof html === "string" ? html : "");
}

/* --------------------------------------------------------------------------
   Merge tags

   The difference between "Hi there" and "Hi Nadia" is most of what a
   personalised campaign is, and it costs one substitution pass.
-------------------------------------------------------------------------- */

export const MERGE_TAGS = ["first_name", "name", "shop", "code"] as const;
export type MergeTag = (typeof MERGE_TAGS)[number];
export type MergeValues = Record<MergeTag, string>;

/**
 * Substituted *after* rendering, not before.
 *
 * A recipient's name is somebody else's input and it reaches the markdown
 * parser as ordinary text: a customer called `**Ann**` would render bold, and
 * one who typed an unclosed bracket into a checkout field could swallow the
 * rest of the paragraph for everyone with that name. Substituting into the
 * finished HTML — escaped, once — means a name is only ever a name.
 *
 * The same pass runs over the plaintext part with escaping off, because
 * there is no markup there for a name to break out of.
 */
export function applyMergeTags(
  content: string,
  values: MergeValues,
  escape = true,
): string {
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) => {
    if (!(MERGE_TAGS as readonly string[]).includes(key)) return whole;
    const value = values[key as MergeTag] ?? "";
    return escape ? escapeHtml(value) : value;
  });
}

/**
 * The values a given recipient's copy gets.
 *
 * `first_name` falls back rather than blanking, because "Hi ," is worse than
 * a generic greeting and a contact imported from a spreadsheet may have no
 * name at all. The fallback is the shop's own language — the one word of
 * this email that is ours rather than the seller's.
 */
export function mergeValuesFor(opts: {
  name: string | null;
  shopName: string;
  couponCode?: string | null;
  fallbackName: string;
}): MergeValues {
  const full = (opts.name ?? "").trim();
  const first = full.split(/\s+/)[0] ?? "";
  return {
    name: full || opts.fallbackName,
    first_name: first || opts.fallbackName,
    shop: opts.shopName,
    code: opts.couponCode ?? "",
  };
}

/* --------------------------------------------------------------------------
   The plain-text part
-------------------------------------------------------------------------- */

/**
 * Generated rather than omitted. A bulk HTML-only message scores worse with
 * every spam filter there is, and the text part is also what a watch and a
 * screen reader read first. Derived from the markdown rather than from the
 * HTML, because markdown *is* the plain-text version — that is what it is for.
 */
export function toPlainText(markdown: string): string {
  return (
    markdown
      // An image is a URL and a caption; both are worth keeping in text.
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) =>
        alt ? `${alt}: ${url}` : url,
      )
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/^#{1,6}[ \t]*/gm, "")
      .replace(/^[ \t]*>[ \t]?/gm, "")
      /*
       * `[ \t]` and not `\s`, which matches a newline: with `\s*` after a
       * multiline `^`, the blank line before a list was swallowed into the
       * first bullet and every paragraph break above a list disappeared.
       */
      .replace(/^[ \t]*[-*+][ \t]+/gm, "· ")
      .replace(/[*_`]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/* --------------------------------------------------------------------------
   Writing help
-------------------------------------------------------------------------- */

/**
 * Roughly how long this takes to read, for the composer's own hint.
 *
 * Not a word count, because nobody has an intuition for what 340 words feels
 * like in an inbox — and the honest signal a seller needs is that a marketing
 * email over about a minute long is not read to the end.
 */
export function readingSeconds(markdown: string): number {
  const words = toPlainText(markdown).split(/\s+/).filter(Boolean).length;
  return Math.round((words / 230) * 60);
}
