import { describe, expect, it } from "vitest";
import { getArticle, getArticles } from "./blog";

/*
 * These read the real `content/blog` directory rather than a fixture.
 *
 * That is the point: the articles ship with the code, so a post with a broken
 * date or a missing description is a build-time mistake, and this is where it
 * gets caught. A fixture would only prove the parser works on a file written
 * to satisfy the parser.
 */

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

  it("does not carry the body — the index only needs summaries", async () => {
    const [first] = await getArticles();
    expect(first && "html" in first).toBe(false);
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
});
