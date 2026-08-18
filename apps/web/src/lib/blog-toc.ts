/**
 * The article's own headings, pulled back out of the HTML it was rendered to.
 *
 * The sidebar on a long post is the single change that makes it readable: a
 * two-thousand-word piece with no map is a scroll bar and a hope, and every
 * blog worth copying — Stripe's, Intercom's, the two the redesign was measured
 * against — answers that with a standing list of what is below.
 *
 * WHY THIS IS A PASS OVER THE OUTPUT RATHER THAN A `marked` RENDERER
 *
 * Overriding the renderer is the obvious way and it ties the blog to one
 * version of one library's extension API — which has changed shape twice in
 * this package's lifetime. This is a pure string function instead: it takes
 * HTML and returns HTML plus a list, so it can be tested from literals, it
 * survives a parser upgrade, and it is the same shape as the sanitiser in
 * `@sailo/marketing/broadcasts` for the same reason. The markdown is ours and
 * ships in the repo, so the headings it emits are `<h2>` and `<h3>` and
 * nothing exotic.
 *
 * Only `h2` and `h3`. `h1` is the page title and belongs to the route, not to
 * the body; `h4` and below are rare in these posts and would turn a map into a
 * second copy of the article.
 */

export type Heading = {
  /** The `id` written onto the tag, and the anchor the sidebar links to. */
  id: string;
  /** Plain text — markup inside a heading is not something a list can show. */
  text: string;
  level: 2 | 3;
};

/**
 * A heading's text, as an anchor.
 *
 * Unicode-aware on purpose. Thirty-five languages publish here, and the naive
 * `[^a-z0-9]` slug turns every Arabic, Greek, Thai and Chinese heading into
 * the empty string — which then collides with every other heading in the
 * article and produces one anchor, repeated, pointing at the top. `\p{L}` and
 * `\p{N}` keep the letters of every script; only punctuation and whitespace
 * are folded.
 *
 * Combining marks are stripped after NFKD so that `Café` and `Cafe` are the
 * same anchor rather than two that look identical in a URL bar.
 */
export function slugifyHeading(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section"
  );
}

/** Markup inside a heading, reduced to the words. `&amp;` back to `&`. */
function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every `h2`/`h3` given a stable `id`, and the list of them.
 *
 * Duplicates are suffixed rather than deduplicated. Two sections genuinely
 * called "What it costs" is ordinary writing, and an anchor that silently
 * points at the first one is worse than `#what-it-costs-2` — the reader who
 * clicks the second entry and lands on the first assumes the page is broken.
 *
 * An `id` already written by the author is left alone. It is the one thing in
 * an article that somebody may have linked to from outside, and rewriting it
 * would break that link to gain nothing.
 */
export function withHeadingAnchors(html: string): {
  html: string;
  headings: Heading[];
} {
  const headings: Heading[] = [];
  const used = new Map<string, number>();

  const decorated = html.replace(
    /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/g,
    (whole, rawLevel: string, attrs: string, inner: string) => {
      const text = plain(inner);
      if (!text) return whole;

      const level = Number(rawLevel) as 2 | 3;
      const existing = /\sid\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1];

      let id = existing ?? slugifyHeading(text);
      if (!existing) {
        const seen = used.get(id) ?? 0;
        used.set(id, seen + 1);
        if (seen > 0) id = `${id}-${seen + 1}`;
      }

      headings.push({ id, text, level });
      return existing
        ? `<h${level}${attrs}>${inner}</h${level}>`
        : `<h${level} id="${id}"${attrs}>${inner}</h${level}>`;
    },
  );

  return { html: decorated, headings };
}

/* --------------------------------------------------------------------------
   The mid-article break
-------------------------------------------------------------------------- */

/**
 * The shortest article that earns an interruption.
 *
 * Measured in rendered characters, which is a rough proxy for length and a
 * deliberately generous one: a card dropped into a six-hundred-word post is
 * an advert wearing an article's clothes, and the reader is right to resent
 * it. Roughly twelve hundred words of body copy before anything interrupts.
 */
const MIN_LENGTH_FOR_BREAK = 7_000;

/** And it needs somewhere to go that is not the second paragraph. */
const MIN_SECTIONS_FOR_BREAK = 3;

/**
 * The body, split in two at a section boundary, so something can sit between.
 *
 * A break lands on an `<h2>` and never inside a section: an offer wedged
 * between a paragraph and the sentence finishing its thought is the pattern
 * that trained everybody to scroll past these. Splitting on the heading
 * closest to the halfway mark means the interruption arrives where a reader
 * is already pausing.
 *
 * A short article, or one with no sections, gets no break at all — the second
 * half comes back empty and the page renders one block. That is the correct
 * answer, not a degraded one.
 */
export function splitAtMidHeading(html: string): [string, string] {
  if (html.length < MIN_LENGTH_FOR_BREAK) return [html, ""];

  const offsets: number[] = [];
  const finder = /<h2[\s>]/g;
  let match: RegExpExecArray | null;
  while ((match = finder.exec(html)) !== null) offsets.push(match.index);

  if (offsets.length < MIN_SECTIONS_FOR_BREAK) return [html, ""];

  /*
   * The first heading is never the break — it is usually within a screen of
   * the title, and an interruption there reads as the page having no article
   * in it at all. The last one is never the break either: a card three
   * paragraphs above the end is an interruption of the conclusion.
   */
  const candidates = offsets.slice(1, -1);
  if (candidates.length === 0) return [html, ""];

  const middle = html.length / 2;
  const at = candidates.reduce((best, offset) =>
    Math.abs(offset - middle) < Math.abs(best - middle) ? offset : best,
  );

  return [html.slice(0, at), html.slice(at)];
}
