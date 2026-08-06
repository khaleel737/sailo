import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { Marked } from "marked";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

/*
 * The blog, read off disk.
 *
 * Articles are `.md` files under `content/blog/<locale>/`, one per post, with
 * YAML frontmatter. Deliberately not in the database: posts are written by us,
 * they ship with the code, they get reviewed in a pull request like anything
 * else, and a marketing page should never be one bad migration away from
 * vanishing.
 *
 * The slug is the URL; the locale is not. `/blog/<slug>` serves the reader's
 * language where that translation has been written and English where it has
 * not, resolved from the same cookie every other page on the site reads. A
 * translation landing later therefore never moves a URL.
 *
 * The cost of that is worth stating rather than discovering: one URL per slug
 * means no distinct indexable page per language and nothing to hang `hreflang`
 * on, so a translation serves readers who arrive but cannot rank on its own.
 * Fixing it means putting the locale in the path, which is the same site-wide
 * change the article route's `dynamicParams` note already describes.
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
