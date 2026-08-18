import { createElement, type ComponentType } from "react";
import { importPage } from "nextra/pages";
import { useMDXComponents } from "@/mdx-components";
import { elementToMarkdown } from "@/lib/to-markdown";
import { docsUrl } from "@/lib/origins";
import type { DocPage } from "@/lib/pages";

/**
 * A page as Markdown a model can actually read.
 *
 * WHY THIS IS NOT JUST THE MDX SOURCE
 *
 * Every enumerable thing on this site — the endpoint entries, the tool
 * arguments, the field tables — is a React component rather than prose,
 * precisely so it cannot drift from the API. The cost is that the raw MDX for
 * `/api/orders` contains the line `<Endpoints match="/orders" />` and nothing
 * else where the reference should be. Serving that to a model is worse than
 * serving nothing: it has been told there is documentation and given a
 * component name nobody outside this repository can resolve.
 *
 * The first instinct is a second renderer — a `docs-markdown.ts` with a
 * hand-written Markdown twin of every component. That works, and it is what the
 * previous docs did, but it is a second description of the same data: adding a
 * component means remembering to add its twin, and the twin that is forgotten
 * is invisible until somebody reads the file a model gets.
 *
 * So this renders **the components themselves**, walking the element tree into
 * Markdown (`./to-markdown`). The output is the page rather than a second
 * description of the same source, so there is no version of it that can
 * disagree — and a component added to a reference module appears here with no
 * further work.
 */

/* -------------------------------------------------------------------------- */
/*  Expansion                                                                  */
/* -------------------------------------------------------------------------- */

/** `---\n…\n---` at the top of the file. Its contents are re-emitted as a heading. */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Import statements the MDX may carry.
 *
 * Most pages import nothing — the reference components are in scope through
 * `mdx-components` — but a page that reaches for one of Nextra's built-ins
 * (`Callout`, `Steps`) does. Either way an import line is machinery, not
 * content.
 */
const IMPORT_LINE = /^import\s[^\n]*\n/gm;

/** A self-closing component tag, with or without simple string attributes. */
const TAG = /<([A-Z][A-Za-z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9]*="[^"]*")*)\s*\/>/g;

/** `path="/shop"` inside a tag's attribute run. */
const ATTRIBUTE = /([a-zA-Z][a-zA-Z0-9]*)="([^"]*)"/g;

function propsFrom(attributes: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [, name, value] of attributes.matchAll(ATTRIBUTE)) {
    if (name && value !== undefined) props[name] = value;
  }
  return props;
}

/**
 * The MDX for one page, with every component tag replaced by its own markup.
 *
 * A tag naming a component that is not in the map is **left exactly as it is**,
 * on purpose. A stray `<Foo />` in the output is visible and reports itself,
 * where silently deleting it would turn "up to <MaxLimit /> per page" into "up
 * to per page" — a sentence that reads as finished and is wrong.
 */
function expand(source: string): string {
  const components = useMDXComponents() as Record<string, ComponentType<Record<string, string>>>;

  return source
    .replace(FRONT_MATTER, "")
    .replace(IMPORT_LINE, "")
    .replace(TAG, (whole, name: string, attributes: string) => {
      const Component = components[name];
      if (typeof Component !== "function") return whole;

      try {
        const rendered = elementToMarkdown(
          createElement(Component, propsFrom(attributes ?? "")),
        );
        if (!rendered.text) return "";
        /*
         * A block gets blank lines around it. A table or a fenced block that
         * begins on the same line as the prose before it is not a table or a
         * fenced block to any Markdown parser — and these tags sit
         * mid-paragraph often enough that this is not hypothetical. A scalar
         * gets none, for the mirror-image reason.
         */
        return rendered.inline ? rendered.text : `\n\n${rendered.text}\n\n`;
      } catch {
        /*
         * A component that throws is a bug worth fixing, but not one worth
         * failing a text file over — `/llms-full.txt` is built from every page
         * at once, so one bad component would otherwise take the whole
         * document with it.
         */
        return whole;
      }
    })
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  The documents                                                              */
/* -------------------------------------------------------------------------- */

/** `/webhooks/signatures` → `["webhooks", "signatures"]`, and `/` → `[]`. */
function segmentsOf(route: string): string[] {
  return route.split("/").filter(Boolean);
}

export async function pageAsMarkdown(page: DocPage): Promise<string> {
  const { sourceCode } = await importPage(segmentsOf(page.route));

  return [
    `# ${page.title}`,
    page.description ? `> ${page.description}` : null,
    `<!-- ${docsUrl(page.route)} -->`,
    expand(sourceCode),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * `/llms.txt` — the index.
 *
 * The format the convention describes: an H1, a blockquote summary, then a
 * list of links with a note on each. A model given this can decide which one
 * page it needs rather than fetching all of them.
 */
export function indexDocument(pages: readonly DocPage[]): string {
  const links = pages.map(
    (page) =>
      `- [${page.title}](${docsUrl(page.route)})${page.description ? `: ${page.description}` : ""}`,
  );

  return [
    "# Sailo",
    "",
    "> Sailo speaks three ways to the outside world, and one API key opens all three: " +
      "webhooks push events to you, a REST API answers questions about a shop, and an MCP " +
      "server lets an AI assistant do both. This is the developer documentation for all of it.",
    "",
    "## Documentation",
    "",
    ...links,
    "",
    `- [Everything, as one file](${docsUrl("/llms-full.txt")}): every page below, concatenated.`,
    "",
  ].join("\n");
}
