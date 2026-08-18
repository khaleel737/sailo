import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KNOWN_TAGS, expandDocsMarkdown } from "./docs-markdown";

/**
 * What keeps `/llms-full.txt` from shipping a model a list of tag names.
 *
 * The docs pages are MDX that imports React components for everything
 * generated from source. `llms-full.txt` serves the processed Markdown, which
 * is that MDX before React runs — so every one of those components is still an
 * unevaluated tag, and `expandDocsMarkdown` is what renders them a second way.
 *
 * The failure that needs a gate is not a bug in the expander. It is somebody
 * adding `<CouponTable />` to a page, seeing it render perfectly in a browser,
 * and never learning that the machine-readable copy of that page now contains
 * the literal string `<CouponTable />` where the table should be. Nothing about
 * that is visible from the page, which is the only place anyone looks.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(HERE, "../../content/docs");

const pages = readdirSync(CONTENT)
  .filter((file) => file.endsWith(".mdx"))
  .map((file) => ({ file, source: readFileSync(join(CONTENT, file), "utf8") }));

/** Component tags used in a page — opening tags only, self-closing included. */
function tagsIn(source: string): string[] {
  return [...source.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((match) => match[1]!);
}

describe("the docs content", () => {
  it("has pages to check, so this file cannot pass by finding nothing", () => {
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(pages.map((page) => page.file)).toContain("api.mdx");
  });

  it.each(pages)("$file uses only components /llms-full.txt can render", ({ source }) => {
    /*
     * `Cards` and `Card` are the layout wrapper on the index page, handled by
     * their own branch in the expander rather than by the tag map. Named here
     * rather than added to `KNOWN_TAGS`, because that set is what the expander
     * substitutes one-for-one and these two are rewritten as a list.
     */
    const handledSeparately = new Set(["Cards", "Card"]);

    for (const tag of tagsIn(source)) {
      if (handledSeparately.has(tag)) continue;
      expect(
        KNOWN_TAGS,
        `<${tag} /> is on a docs page but lib/docs-markdown.ts cannot render it, ` +
          "so /llms-full.txt would serve the tag name instead of what it stands for.",
      ).toContain(tag);
    }
  });

  it.each(pages)("$file leaves no component tag in its Markdown", ({ source }) => {
    /*
     * End to end, against the real page rather than a fixture: expand it and
     * assert nothing that looks like a component survived. This is the
     * assertion that would have caught the first version of the route, which
     * shipped `<EndpointIndex />` to anything that fetched it.
     */
    const expanded = expandDocsMarkdown(source);
    const leftovers = [...expanded.matchAll(/<\/?([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]!);

    expect([...new Set(leftovers)]).toEqual([]);
  });

  it.each(pages)("$file drops its import statements", ({ source }) => {
    // They name modules nobody outside this repo can resolve.
    expect(expandDocsMarkdown(source)).not.toContain('from "@/components/docs/');
  });

  it("renders the endpoint table as Markdown rather than as a tag", () => {
    const api = pages.find((page) => page.file === "api.mdx")!;
    const expanded = expandDocsMarkdown(api.source);

    expect(expanded).toContain("| Method | Path | What it does |");
    expect(expanded).toContain("`/contacts/{id}/tags`");
  });

  it("renders the payload fields that have no REST endpoint behind them", () => {
    const webhooks = pages.find((page) => page.file === "webhooks.mdx")!;
    const expanded = expandDocsMarkdown(webhooks.source);

    // The nine events whose shape appears nowhere else in the documentation.
    expect(expanded).toContain("`cancelAtPeriodEnd`");
    expect(expanded).toContain("`completenessBp`");
  });
});
