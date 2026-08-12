import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { cacheLife, cacheTag } from "next/cache";
import matter from "gray-matter";
import { Marked } from "marked";
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "@sailo/i18n/config";

/*
 * The blog, read off disk.
 *
 * Articles are `.md` files under `content/blog/<locale>/`, one per post, with
 * YAML frontmatter. Deliberately not in the database: posts are written by us,
 * they ship with the code, they get reviewed in a pull request like anything
 * else, and a marketing page should never be one bad migration away from
 * vanishing.
 *
 * The URL carries the locale: `/<locale>/blog/<slug>`, rewritten onto
 * `/blog/<locale>/<slug>` by `src/proxy.ts` because `[handle]` already owns the
 * root dynamic segment and shops must keep the bare `sailo.store/yourname`.
 *
 * That prefix is what makes the writing worth doing. Each language is a page a
 * crawler can index as that language, where a single cookie-switched URL per
 * slug could only ever be indexed once, whichever language it happened to
 * serve. The blog is also written per market rather than translated, so the
 * French index is French articles and not French copies of English ones.
 *
 * Two families of reader live below, and they are not interchangeable:
 * `getArticle`/`getArticles` resolve across languages with a fallback, which is
 * still what the sitemap and any locale-blind caller wants. `getArticleIn` and
 * friends read one language and stop, which is what a locale-prefixed URL
 * requires — serving English under `/fr/` would put the wrong language behind a
 * `lang="fr"` page.
 *
 * Everything here is server-only — `node:fs` cannot be bundled for the browser,
 * so importing this from a Client Component is a build error rather than a
 * runtime surprise.
 */

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

export type Article = {
  slug: string;
  title: string;
  description: string;
  /** ISO date, from the frontmatter. Sorting and `<time>` both read it. */
  date: string;
  author: string;
  /** Cover image, served from /public. Optional — the card falls back. */
  cover: string | null;
  coverAlt: string;
  tags: string[];
  /**
   * The language this copy is actually written in — not the language that was
   * asked for. A reader on `pt` who gets the English original needs `en` here,
   * because it is what drives `lang` and `dir` on the rendered article.
   */
  locale: Locale;
  /** Rendered HTML body. Only present from `getArticle`. */
  html: string;
  /** Rounded up, in minutes. */
  readingMinutes: number;
};

export type ArticleSummary = Omit<Article, "html">;

/**
 * One configured parser, reused.
 *
 * `gfm` for tables and strikethrough, `breaks: false` so a single newline is a
 * wrap rather than a `<br>` — the way anyone writing prose in Markdown
 * expects. No raw-HTML escaping is switched off: these files are ours, but
 * "ours" is exactly the assumption that ages badly, so the parser stays on its
 * defaults rather than being told to trust the input.
 */
const marked = new Marked({ gfm: true, breaks: false });

/** 200 words a minute, which is the low end and so never flatters the post. */
function readingTime(body: string) {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function parse(slug: string, locale: Locale, raw: string) {
  const { data, content } = matter(raw);
  // Named the way the file is on disk, so a build failure is a path to open.
  const where = `${locale}/${slug}.md`;

  // A post missing either of these is a mistake worth failing the build over,
  // not something to paper over with an empty string in a <title>.
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  if (!title) throw new Error(`[blog] ${where} has no \`title\` in its frontmatter`);
  if (!description) {
    throw new Error(`[blog] ${where} has no \`description\` in its frontmatter`);
  }

  const date = data.date instanceof Date ? data.date.toISOString() : String(data.date ?? "");
  if (Number.isNaN(Date.parse(date))) {
    throw new Error(`[blog] ${where} has an unreadable \`date\`: ${String(data.date)}`);
  }

  return {
    slug,
    title,
    description,
    date,
    // Posts are the product's voice, not an individual's — a post that forgets
    // to name an author should read as written by the team, not by nobody.
    author: typeof data.author === "string" ? data.author : "Sailo team",
    cover: typeof data.cover === "string" ? data.cover : null,
    // Falling back to the title keeps the alt text meaningful rather than
    // duplicating the filename, which is what an empty alt would amount to.
    coverAlt: typeof data.coverAlt === "string" ? data.coverAlt : title,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    locale,
    readingMinutes: readingTime(content),
    body: content,
  };
}

/**
 * The locale a caller asked for, or English.
 *
 * The locale reaches this module from a cookie, so it is attacker-shaped until
 * something checks it, and it is about to be joined onto a filesystem path.
 * `isLocale` is that check: the value has to be one of the shipped codes in
 * `i18n/config` or it does not get used. TypeScript says `Locale` at the call
 * sites; this is what makes it true at runtime.
 */
function safeLocale(locale: Locale): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/** The language directories that actually exist. Anything else on disk is ignored. */
async function localesOnDisk(): Promise<Locale[]> {
  try {
    const entries = await readdir(BLOG_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && isLocale(entry.name))
      .map((entry) => entry.name as Locale);
  } catch {
    // No directory yet is not an error — the blog is simply empty.
    return [];
  }
}

async function readSlugs(locale: Locale): Promise<string[]> {
  try {
    const entries = await readdir(path.join(BLOG_DIR, safeLocale(locale)));
    return entries.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

/**
 * Every slug on disk, mapped to the languages it has been written in.
 *
 * One readdir per language directory, at build time, for a set of files that
 * ships with the code — cheap enough that the alternative, probing one path
 * per shipped language on every miss, is not worth the bookkeeping.
 */
async function readIndex(): Promise<Map<string, Locale[]>> {
  const locales = await localesOnDisk();
  const listings = await Promise.all(
    locales.map(async (locale) => [locale, await readSlugs(locale)] as const),
  );

  const index = new Map<string, Locale[]>();
  for (const [locale, slugs] of listings) {
    for (const slug of slugs) {
      index.set(slug, [...(index.get(slug) ?? []), locale]);
    }
  }
  return index;
}

/**
 * Which copy of an article to serve: the reader's language, then English, then
 * whatever exists.
 *
 * The last step is what stops a URL from dying. A post written only in
 * Portuguese — Pix, say, which has no English audience worth the words — is
 * still a real article at a real slug, and answering 404 to everyone but
 * Brazilians would be a bug rather than a language preference.
 */
function preferred(available: readonly Locale[], wanted: Locale): Locale | null {
  return (
    available.find((l) => l === wanted) ??
    available.find((l) => l === DEFAULT_LOCALE) ??
    available[0] ??
    null
  );
}

async function readArticle(slug: string, locale: Locale) {
  const raw = await readFile(path.join(BLOG_DIR, safeLocale(locale), `${slug}.md`), "utf8");
  return parse(slug, safeLocale(locale), raw);
}

async function summarise(slug: string, available: readonly Locale[], wanted: Locale) {
  const from = preferred(available, wanted);
  if (!from) return null;
  const { body: _body, ...summary } = await readArticle(slug, from);
  return summary;
}

function byNewest(summaries: readonly (ArticleSummary | null)[]): ArticleSummary[] {
  return summaries
    .filter((article) => article !== null)
    .toSorted((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/**
 * The articles a reader in this language can actually read — written in their
 * language or in English, theirs preferred. Newest first, summaries only.
 *
 * Not the whole blog, deliberately. A post written only in Portuguese belongs
 * in the Portuguese index and in the sitemap, but listing it for an English
 * reader would be handing them a page they cannot read to make a list longer.
 */
export async function getArticles(locale: Locale = DEFAULT_LOCALE): Promise<ArticleSummary[]> {
  const wanted = safeLocale(locale);
  const index = await readIndex();

  return byNewest(
    await Promise.all(
      [...index]
        .filter(([, available]) =>
          available.some((l) => l === wanted || l === DEFAULT_LOCALE),
        )
        .map(([slug, available]) => summarise(slug, available, wanted)),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/*  Reading one locale exactly                                                 */
/* -------------------------------------------------------------------------- */

/*
 * Everything above this line resolves a slug across languages, falling back to
 * English — the right behaviour when one URL had to serve every reader.
 *
 * The URLs now carry the locale (`/blog/fr/…`), so these read one language and
 * stop. `/blog/fr/<slug>` must serve the French article or nothing: falling
 * back to English under a French URL would put the wrong language behind a
 * `lang="fr"` page and invite a search engine to index it as French.
 */

/** Locales that actually have articles on disk, in the shipped order. */
export async function getContentLocales(): Promise<Locale[]> {
  "use cache";
  cacheLife("max");
  cacheTag("blog-locales");

  const present = new Set(await localesOnDisk());
  return LOCALES.map((l) => l.code).filter((code) => present.has(code));
}

/** Articles written in exactly this locale, newest first. No fallback. */
export async function getArticlesIn(locale: Locale): Promise<ArticleSummary[]> {
  "use cache";
  cacheLife("max");
  cacheTag("blog-articles");

  const wanted = safeLocale(locale);
  const slugs = await readSlugs(wanted);

  return byNewest(
    await Promise.all(
      slugs.map(async (slug) => {
        const { body: _body, ...summary } = await readArticle(slug, wanted);
        return summary;
      }),
    ),
  );
}

/** One page of a single locale's index. */
export async function getArticlePageIn(locale: Locale, page = 1): Promise<ArticlePage> {
  const all = await getArticlesIn(locale);
  const pageCount = Math.max(1, Math.ceil(all.length / ARTICLES_PER_PAGE));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * ARTICLES_PER_PAGE;

  return { articles: all.slice(start, start + ARTICLES_PER_PAGE), page: current, pageCount, total: all.length };
}

/** One article in exactly this locale, or null. */
export async function getArticleIn(slug: string, locale: Locale): Promise<Article | null> {
  "use cache";
  cacheLife("max");
  cacheTag("blog-article");

  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;

  const wanted = safeLocale(locale);
  const available = (await readIndex()).get(slug);
  if (!available?.includes(wanted)) return null;

  const { body, ...rest } = await readArticle(slug, wanted);
  return { ...rest, html: await marked.parse(body) };
}

/**
 * Every locale this exact slug is written in.
 *
 * This is what `hreflang` needs, and it is deliberately keyed on the slug: two
 * pages are alternates only when they are the same article in another language.
 * Most of this blog is written per market rather than translated, so for most
 * articles this returns one locale and no alternates are emitted — which is
 * correct. Declaring unrelated articles as alternates would be a lie told to a
 * crawler in a machine-readable format.
 */
export async function getSlugLocales(slug: string): Promise<Locale[]> {
  "use cache";
  cacheLife("max");
  cacheTag("blog-slug-locales");
  return (await readIndex()).get(slug) ?? [];
}

/** Every (locale, slug) pair on disk — the full URL surface, for the sitemap. */
export async function getEveryArticleByLocale(): Promise<
  Array<{ locale: Locale; article: ArticleSummary }>
> {
  "use cache";
  cacheLife("max");
  cacheTag("blog-every");

  const locales = await getContentLocales();
  const perLocale = await Promise.all(
    locales.map(async (locale) =>
      (await getArticlesIn(locale)).map((article) => ({ locale, article })),
    ),
  );
  return perLocale.flat();
}

/**
 * How many articles an index page shows.
 *
 * Twelve is a lead plus eleven, which fills the two-column grid evenly and
 * keeps the page to a few screens on a phone. The number lives here rather than
 * in the route because the reader is what has to slice by it.
 */
export const ARTICLES_PER_PAGE = 12;

export type ArticlePage = {
  articles: ArticleSummary[];
  /** Clamped into range, so an out-of-range request lands on a real page. */
  page: number;
  pageCount: number;
  total: number;
};

/**
 * One entry per slug across every language, English preferred where it exists.
 *
 * This is the set that has a URL — what the sitemap advertises. It is a
 * different question from what any one reader should be shown, which is why it
 * is a different function rather than a flag on the one above.
 */
export async function getEveryArticle(): Promise<ArticleSummary[]> {
  const index = await readIndex();

  return byNewest(
    await Promise.all(
      [...index].map(([slug, available]) => summarise(slug, available, DEFAULT_LOCALE)),
    ),
  );
}

/**
 * Every slug that exists in any language.
 *
 * This is the route's parameter list, so it has to be the union rather than the
 * English set — a translation-only post is still a page that has to build.
 */
export async function getArticleSlugs(): Promise<string[]> {
  return [...(await readIndex()).keys()].toSorted();
}

/** One article with its body rendered, or null if the slug does not exist. */
export async function getArticle(
  slug: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<Article | null> {
  // The slug reaches here from the URL. Anything that is not a plain slug is
  // refused before it can be joined onto a path and walk out of the directory.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;

  const available = (await readIndex()).get(slug);
  if (!available) return null;

  const from = preferred(available, safeLocale(locale));
  if (!from) return null;

  const { body, ...rest } = await readArticle(slug, from);
  return { ...rest, html: await marked.parse(body) };
}
