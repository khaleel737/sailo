import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import GithubSlugger from "github-slugger";
import { ENDPOINTS } from "@sailo/api/rest";
import { MCP_TOOLS } from "@sailo/api/mcp";

/**
 * The pages, checked as pages.
 *
 * `contract.test.ts` next door checks that the *reference* describes the real
 * API. This checks the things that go wrong in prose on a site with thirty-odd
 * cross-linked pages, none of which any type system can see:
 *
 * - A link to a page that does not exist. Invisible until a reader clicks it,
 *   and a 404 inside your own documentation is worse than no link.
 * - A page with no `description`. It is the meta description and the sidebar
 *   card subtitle, and an empty one is a search result nobody clicks.
 * - The rate-limit page publishing the failed-authentication budget, which
 *   would turn it into a guide for telling a valid key from an invalid one by
 *   watching for a 429.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(HERE, "../../content");

/* -------------------------------------------------------------------------- */
/*  The pages on disk                                                          */
/* -------------------------------------------------------------------------- */

type Page = { route: string; file: string; source: string };

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(full);
    return entry.name.endsWith(".mdx") ? [full] : [];
  });
}

/** `content/api/orders.mdx` → `/api/orders`; `content/api/index.mdx` → `/api`. */
function routeOf(file: string): string {
  const withoutExtension = relative(CONTENT, file).replace(/\.mdx$/, "");
  const segments = withoutExtension.split("/").filter((segment) => segment !== "index");
  return `/${segments.join("/")}`;
}

const PAGES: Page[] = mdxFiles(CONTENT)
  .toSorted()
  .map((file) => ({ route: routeOf(file), file, source: readFileSync(file, "utf8") }));

const ROUTES = new Set(PAGES.map((page) => page.route));

/**
 * Routes this site serves that are not pages.
 *
 * Named explicitly rather than pattern-matched, so a link to `/anything.txt`
 * still has to be argued for in a diff.
 */
const NON_PAGE_ROUTES = new Set(["/llms.txt", "/llms-full.txt", "/sitemap.xml", "/robots.txt"]);

const frontMatter = (source: string): string => /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? "";

/* -------------------------------------------------------------------------- */

describe("the content directory", () => {
  /*
   * A guard on the guard: a walker that found nothing would make every
   * assertion below pass vacuously.
   */
  it("finds the pages at all", () => {
    expect(PAGES.length).toBeGreaterThan(20);
    expect(ROUTES.has("/")).toBe(true);
    expect(ROUTES.has("/api/orders")).toBe(true);
  });

  it.each(PAGES.map((page) => [page.route, page] as const))("%s has front matter", (_route, page) => {
    const matter = frontMatter(page.source);

    expect(matter, `${page.file} has no front matter block.`).not.toBe("");
    expect(matter, `${page.file} has no title.`).toMatch(/^title:\s*\S/m);
    /*
     * The description is the meta description, the Open Graph description and
     * the line under the page in `/llms.txt`. Three readers, one line, and a
     * page without it is invisible to all three.
     */
    expect(matter, `${page.file} has no description.`).toMatch(/^description:\s*\S/m);
  });

  it.each(PAGES.map((page) => [page.route, page] as const))(
    "%s keeps its description short enough to survive a search result",
    (_route, page) => {
      const description = /^description:\s*(.+)$/m.exec(frontMatter(page.source))?.[1] ?? "";
      /*
       * Google truncates around 160 characters. Longer is not an error, but it
       * is a sentence whose ending nobody reads — and these are written to be
       * read whole.
       */
      expect(description.length, `${page.file}: ${description.length} characters.`).toBeLessThan(220);
    },
  );
});

describe("internal links", () => {
  /**
   * Every `](/…)` in the prose, with its page.
   *
   * Markdown links only. A `href=` inside a component is generated from a
   * constant and is covered by `contract.test.ts`; these are the ones a person
   * typed.
   */
  const LINKS = PAGES.flatMap((page) =>
    [...page.source.matchAll(/\]\((\/[^)\s]*)\)/g)].map((match) => ({
      page: page.route,
      file: page.file,
      target: match[1] ?? "",
    })),
  );

  it("finds links at all", () => {
    expect(LINKS.length).toBeGreaterThan(50);
  });

  it.each(LINKS.map((link) => [`${link.page} → ${link.target}`, link] as const))(
    "%s resolves",
    (_label, link) => {
      const [path = "/"] = link.target.split("#");

      if (NON_PAGE_ROUTES.has(path)) return;

      /*
       * `/api/v1/openapi.json` and the other product routes are on the *app*
       * origin, not this one. They are written as absolute URLs everywhere they
       * are a real link; where one appears as a path it is inside backticks as
       * a literal, and a literal is not a link.
       */
      if (path.startsWith("/api/v1/")) return;

      expect(
        [...ROUTES],
        `${link.file} links to ${link.target}, which is not a page on this site.`,
      ).toContain(path);
    },
  );

  /**
   * Every id a page actually offers as a link target.
   *
   * Two sources, because a page has two kinds. Headings are slugged with
   * `github-slugger` — **the same package Nextra uses**, rather than a
   * reimplementation of its rules. That distinction is the whole value of this
   * test: a hand-rolled slugifier agrees with the real one on the easy cases
   * and disagrees on exactly the headings worth checking. `### rate_limited —
   * 429` slugs to `rate_limited--429`, with two hyphens, which is not what
   * anybody types.
   *
   * The other kind is generated: an endpoint's `operationId` and an MCP tool
   * name are ids on the rendered page that appear nowhere in its source.
   */
  const GENERATED_IDS = new Set([
    ...ENDPOINTS.map((endpoint) => endpoint.id),
    ...MCP_TOOLS.map((tool) => tool.name),
  ]);

  function anchorsOn(page: Page): Set<string> {
    const slugger = new GithubSlugger();
    const headings = [...page.source.matchAll(/^#{2,4}\s+(.+)$/gm)].map(([, text = ""]) =>
      /*
       * The heading text as MDX renders it: a code span's backticks are markup
       * and are not part of the text the slugger sees. Emphasis and links are
       * stripped for the same reason.
       */
      slugger.slug(text.replace(/`/g, "").replace(/\*\*?/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")),
    );
    return new Set(headings);
  }

  const HEADING_LINKS = LINKS.filter((link) => link.target.includes("#"));

  it.each(HEADING_LINKS.map((link) => [`${link.page} → ${link.target}`, link] as const))(
    "%s names a heading or a generated id",
    (_label, link) => {
      const [path = "/", anchor = ""] = link.target.split("#");
      if (NON_PAGE_ROUTES.has(path) || path.startsWith("/api/v1/")) return;
      if (GENERATED_IDS.has(anchor)) return;

      const target = PAGES.find((page) => page.route === path);
      if (!target) return; // The link-resolves test above already reports this.

      expect(
        [...anchorsOn(target)],
        `${link.file} links to #${anchor}, which is on no heading of ${path}.`,
      ).toContain(anchor);
    },
  );
});

describe("the rate limits page", () => {
  const page = PAGES.find((candidate) => candidate.route === "/rate-limits");

  it("exists", () => {
    expect(page).toBeDefined();
  });

  it("publishes the per-key limit", () => {
    expect(page?.source).toContain("240 requests a minute");
  });

  /**
   * And not the other one.
   *
   * The failed-authentication budget is the ceiling on *guessing*. Publishing
   * it would turn this page into a guide for telling a valid key from an
   * invalid one by watching for a 429 — which is precisely what the refund on
   * success exists to prevent a real client from ever noticing.
   */
  it("does not publish the failed-authentication budget", () => {
    expect(page?.source).not.toMatch(/\b\d+\s+(?:failed|attempts?|guesses)\b/i);
    expect(page?.source).not.toMatch(/ceiling of \w+/i);
  });
});
