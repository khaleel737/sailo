import { describe, expect, it } from "vitest";
import { getArticle, getArticleSlugs, getArticles, getEveryArticle } from "./blog";
import { LOCALES, type Locale } from "@sailo/i18n/config";

/*
 * These read the real `content/blog` directory rather than a fixture.
 *
 * That is the point: the articles ship with the code, so a post with a broken
 * date or a missing description is a build-time mistake, and this is where it
 * gets caught. A fixture would only prove the parser works on a file written
 * to satisfy the parser.
 */

const CODES = LOCALES.map((l) => l.code) as readonly string[];

describe("getArticles", () => {
  it("reads every article on disk", async () => {
    const articles = await getArticles();
    expect(articles.length).toBeGreaterThan(0);
  });

  it("returns them newest first", async () => {
    const dates = (await getArticles()).map((a) => Date.parse(a.date));
    expect(dates).toEqual(dates.toSorted((a, b) => b - a));
  });

  it("gives every article the frontmatter the pages depend on", async () => {
    for (const article of await getArticles()) {
      expect(article.slug, "slug").toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(article.title.length, `${article.slug}: title`).toBeGreaterThan(0);
      expect(article.description.length, `${article.slug}: description`).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(article.date)), `${article.slug}: date`).toBe(false);
      expect(article.readingMinutes, `${article.slug}: reading time`).toBeGreaterThan(0);
      // The language it is written in, which drives `lang` and `dir` on the
      // page. A directory that is not a shipped locale must never reach here.
      expect(CODES, `${article.slug}: locale`).toContain(article.locale);
    }
  });

  it("points every cover at a file that will actually be served", async () => {
    // A cover is a path under /public. A typo here is a broken image on the
    // one page whose job is to look considered.
    const { access } = await import("node:fs/promises");
    const path = await import("node:path");

    for (const article of await getArticles()) {
      if (!article.cover) continue;
      expect(article.cover.startsWith("/"), `${article.slug}: cover must be absolute`).toBe(true);
      await expect(
        access(path.join(process.cwd(), "public", article.cover)),
        `${article.slug}: ${article.cover} is missing from /public`,
      ).resolves.toBeUndefined();
      expect(article.coverAlt.length, `${article.slug}: coverAlt`).toBeGreaterThan(0);
    }
  });

  it("gives every article its own cover, in every language", async () => {
    /*
     * Two articles sharing a picture makes the index look generated, which is
     * the thing a hand-written blog most needs not to look like.
     *
     * Walks the directory rather than asking the reader for a list: a reader
     * scoped to one locale would never see a translation reusing an English
     * article's cover, and that is exactly the case a copy-pasted new post
     * creates.
     */
    const { readdir, readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const matter = (await import("gray-matter")).default;
    const root = path.join(process.cwd(), "content", "blog");

    const owner = new Map<string, string>();

    for (const dir of await readdir(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const file of await readdir(path.join(root, dir.name))) {
        if (!file.endsWith(".md")) continue;
        const raw = await readFile(path.join(root, dir.name, file), "utf8");
        const cover = matter(raw).data.cover;
        if (typeof cover !== "string") continue;

        const here = `${dir.name}/${file.replace(/\.md$/, "")}`;
        expect(owner.get(cover), `${here} reuses ${owner.get(cover)}'s cover: ${cover}`).toBeUndefined();
        owner.set(cover, here);
      }
    }
  });

  it("does not carry the body — the index only needs summaries", async () => {
    const [first] = await getArticles();
    expect(first && "html" in first).toBe(false);
  });

  it("falls back to English for a language nothing has been written in yet", async () => {
    /*
     * The empty locale is found at run time rather than named.
     *
     * This test used to hard-code `th`, which was empty when it was written and
     * has ten articles now — so it failed on the day Thai landed, reporting a
     * fallback bug that did not exist. Ask the directory instead.
     */
    const { readdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.join(process.cwd(), "content", "blog");
    const written = new Set(
      (await readdir(root, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    );

    const empty = LOCALES.map((l) => l.code).find((c) => c !== "en" && !written.has(c));
    if (!empty) return; // Every shipped language has articles. Nothing to prove.

    const english = await getArticles("en");
    const untranslated = await getArticles(empty);

    expect(untranslated.map((a) => a.slug)).toEqual(english.map((a) => a.slug));
    expect(untranslated.every((a) => a.locale === "en")).toBe(true);
  });

  it("ignores a locale that is not one of the shipped codes", async () => {
    // The locale arrives from a cookie and is joined onto a path, so a value
    // that is not a locale must not be treated as a directory name.
    for (const attempt of ["../..", "../../../etc", "EN", ""]) {
      const articles = await getArticles(attempt as Locale);
      expect(articles.length, attempt).toBeGreaterThan(0);
      expect(
        articles.every((a) => a.locale === "en"),
        attempt,
      ).toBe(true);
    }
  });
});

describe("getEveryArticle", () => {
  it("covers every slug exactly once, whatever language it was written in", async () => {
    // This is what the sitemap advertises, so a slug missing here is a page
    // that exists and that nothing will ever crawl.
    const every = await getEveryArticle();
    const slugs = every.map((a) => a.slug);

    expect(slugs.toSorted()).toEqual(await getArticleSlugs());
    expect(slugs).toEqual([...new Set(slugs)]);
  });

  it("returns them newest first", async () => {
    const dates = (await getEveryArticle()).map((a) => Date.parse(a.date));
    expect(dates).toEqual(dates.toSorted((a, b) => b - a));
  });
});

describe("getArticleSlugs", () => {
  it("lists every slug that exists in any language", async () => {
    const slugs = await getArticleSlugs();
    const english = (await getArticles("en")).map((a) => a.slug);

    // The route builds one page per slug, so every published article has to be
    // in here — an English-only blog makes these the same set.
    for (const slug of english) expect(slugs).toContain(slug);
    expect(slugs).toEqual([...new Set(slugs)]);
    expect(slugs).toEqual(slugs.toSorted());
  });
});

describe("the keyword registry", () => {
  /*
   * `docs/blog-keywords.csv` is the anti-cannibalisation rule from the blog
   * brief: one primary keyword per article, one article per primary keyword,
   * per locale. Two articles chasing the same query do not rank twice — Google
   * picks one and drops the other, and the programme is a few hundred articles
   * long, so the moment that rule is only written down is the moment it stops
   * being true. It is checked here instead.
   */
  const COLUMNS = [
    "locale",
    "slug",
    "primary_keyword",
    "intent",
    "country",
    "cluster",
    "status",
  ] as const;

  async function readRegistry() {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await readFile(
      path.join(process.cwd(), "docs", "blog-keywords.csv"),
      "utf8",
    );

    const [header, ...lines] = raw.trim().split("\n");
    expect(header?.split(","), "header row").toEqual([...COLUMNS]);

    return lines.map((line, i) => {
      const cells = line.split(",");
      // Split-on-comma is only safe while no field needs quoting. Rather than
      // pull in a parser for a file this size, hold the file to the simpler
      // shape and say so when it stops fitting.
      expect(line, `row ${i + 2}: no field may contain a quote or an empty cell`).not.toMatch(
        /["']|,,|,$/,
      );
      expect(cells.length, `row ${i + 2}: wrong number of columns`).toBe(COLUMNS.length);
      return Object.fromEntries(COLUMNS.map((c, n) => [c, cells[n] ?? ""])) as Record<
        (typeof COLUMNS)[number],
        string
      >;
    });
  }

  it("claims one primary keyword per article, per locale", async () => {
    const seen = new Set<string>();
    for (const row of await readRegistry()) {
      const key = `${row.locale}:${row.primary_keyword}`;
      expect(seen.has(key), `${key} is claimed twice`).toBe(false);
      seen.add(key);
    }
  });

  it("claims one row per article, per locale", async () => {
    const seen = new Set<string>();
    for (const row of await readRegistry()) {
      const key = `${row.locale}:${row.slug}`;
      expect(seen.has(key), `${key} has two rows`).toBe(false);
      seen.add(key);
    }
  });

  it("never gives two articles the same slug", async () => {
    /*
     * Slugs must be unique across every language, not just within one.
     *
     * The URL would tolerate a collision — `/bs/blog/x` and `/sr/blog/x` are
     * different pages — but the cover for an article is `covers/<slug>.svg`,
     * with no locale in the path, so two articles sharing a slug would share a
     * picture and silently overwrite each other's file. Two closely related
     * languages produced exactly that collision once already.
     */
    const owner = new Map<string, string>();
    for (const row of await readRegistry()) {
      const previous = owner.get(row.slug);
      expect(previous, `${row.locale}/${row.slug} reuses a slug owned by ${previous}`).toBeUndefined();
      owner.set(row.slug, `${row.locale}/${row.slug}`);
    }
  });

  it("only names locales the site actually ships", async () => {
    for (const row of await readRegistry()) {
      expect(CODES, `${row.slug}: locale`).toContain(row.locale);
      expect(row.slug, "slug").toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it("has a row for every article on disk, in every language", async () => {
    // Walks the directory rather than asking the reader for its list: a
    // translation shares its slug with the original, so anything that dedupes
    // by slug would let a translated article through unregistered. A
    // translation is its own row — it targets its own market's keyword.
    //
    // The other direction is allowed: a row may be claimed before the article
    // is written. An article without a row is the failure — it means a keyword
    // was picked without checking whether something else already owns it.
    const { readdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.join(process.cwd(), "content", "blog");

    const rows = await readRegistry();
    const dirs = await readdir(root, { withFileTypes: true });

    for (const dir of dirs.filter((d) => d.isDirectory())) {
      // The reader skips a directory that is not a shipped locale, so a typo
      // here is not a broken page — it is an article nobody will ever see and
      // no error to say why. Fail on it where the reason is legible.
      expect(CODES, `content/blog/${dir.name} is not a shipped locale`).toContain(dir.name);

      for (const file of await readdir(path.join(root, dir.name))) {
        if (!file.endsWith(".md")) continue;
        const slug = file.replace(/\.md$/, "");
        expect(
          rows.some((r) => r.slug === slug && r.locale === dir.name),
          `${dir.name}/${slug} is published with no registry row`,
        ).toBe(true);
      }
    }
  });
});

describe("getArticle", () => {
  it("renders Markdown to HTML", async () => {
    const [summary] = await getArticles();
    expect(summary).toBeDefined();

    const article = await getArticle(summary?.slug ?? "");
    expect(article).not.toBeNull();
    expect(article?.html).toContain("<p>");
    // Frontmatter is metadata, not body — it must not survive into the page.
    expect(article?.html).not.toContain("---");
    expect(article?.html).not.toContain("description:");
  });

  it("renders GitHub-flavoured tables", async () => {
    const article = await getArticle("what-to-photograph-when-you-sell-food");
    expect(article?.html).toContain("<table>");
  });

  it("serves the English copy when the reader's language has no translation", async () => {
    const article = await getArticle("what-to-photograph-when-you-sell-food", "ar");
    expect(article).not.toBeNull();
    expect(article?.locale).toBe("en");
  });

  it("returns null for a slug that does not exist", async () => {
    expect(await getArticle("no-such-article")).toBeNull();
  });

  it("refuses a slug that tries to climb out of the content directory", async () => {
    // The slug arrives from the URL, so this is the boundary that matters.
    for (const attempt of [
      "../../../etc/passwd",
      "..%2f..%2fpackage",
      "a/../../package",
      "Uppercase",
      "",
      ".env",
    ]) {
      expect(await getArticle(attempt), attempt).toBeNull();
    }
  });

  it("refuses a locale that tries to climb out of the content directory", async () => {
    // The locale is the other half of the path, and it comes from a cookie.
    for (const attempt of ["../..", "../../../etc", ".."]) {
      const article = await getArticle(
        "what-to-photograph-when-you-sell-food",
        attempt as Locale,
      );
      expect(article?.locale, attempt).toBe("en");
    }
  });
});
