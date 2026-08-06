import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { Marked } from "marked";

/*
 * The blog, read off disk.
 *
 * Articles are `.md` files in `content/blog`, one per post, with YAML
 * frontmatter. Deliberately not in the database: posts are written by us, they
 * ship with the code, they get reviewed in a pull request like anything else,
 * and a marketing page should never be one bad migration away from vanishing.
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

function parse(slug: string, raw: string) {
  const { data, content } = matter(raw);

  // A post missing either of these is a mistake worth failing the build over,
  // not something to paper over with an empty string in a <title>.
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  if (!title) throw new Error(`[blog] ${slug}.md has no \`title\` in its frontmatter`);
  if (!description) {
    throw new Error(`[blog] ${slug}.md has no \`description\` in its frontmatter`);
  }

  const date = data.date instanceof Date ? data.date.toISOString() : String(data.date ?? "");
  if (Number.isNaN(Date.parse(date))) {
    throw new Error(`[blog] ${slug}.md has an unreadable \`date\`: ${String(data.date)}`);
  }

  return {
    slug,
    title,
    description,
    date,
    author: typeof data.author === "string" ? data.author : "Sailo",
    cover: typeof data.cover === "string" ? data.cover : null,
    // Falling back to the title keeps the alt text meaningful rather than
    // duplicating the filename, which is what an empty alt would amount to.
    coverAlt: typeof data.coverAlt === "string" ? data.coverAlt : title,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    readingMinutes: readingTime(content),
    body: content,
  };
}

async function readSlugs() {
  try {
    const entries = await readdir(BLOG_DIR);
    return entries.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
  } catch {
    // No directory yet is not an error — the blog is simply empty.
    return [];
  }
}

/** Every article, newest first. Summaries only; bodies are not parsed. */
export async function getArticles(): Promise<ArticleSummary[]> {
  const slugs = await readSlugs();

  const articles = await Promise.all(
    slugs.map(async (slug) => {
      const raw = await readFile(path.join(BLOG_DIR, `${slug}.md`), "utf8");
      const { body: _body, ...summary } = parse(slug, raw);
      return summary;
    }),
  );

  return articles.toSorted((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/** One article with its body rendered, or null if the slug does not exist. */
export async function getArticle(slug: string): Promise<Article | null> {
  // The slug reaches here from the URL. Anything that is not a plain slug is
  // refused before it can be joined onto a path and walk out of the directory.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;

  let raw: string;
  try {
    raw = await readFile(path.join(BLOG_DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }

  const { body, ...rest } = parse(slug, raw);
  return { ...rest, html: await marked.parse(body) };
}
