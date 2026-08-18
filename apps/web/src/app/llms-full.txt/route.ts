import { absolute } from "@sailo/core/origin";
import { source } from "@/lib/docs-source";

/**
 * `/llms-full.txt` — every documentation page, as one Markdown file.
 *
 * The companion to `/llms.txt`, which lists the pages. This is the pages
 * themselves, in the order the sidebar puts them, so a model given the URL has
 * the whole developer surface in one fetch rather than four.
 *
 * `getText("processed")` is the MDX after its plugins have run, which is what
 * `includeProcessedMarkdown` in `lib/docs-source.ts` exists to produce. It is
 * the version a model should read: imports resolved away, and the generated
 * tables — endpoints, tools, payload fields — rendered as Markdown rather than
 * left as a JSX tag naming a component nobody outside this repo can see.
 */

export async function GET() {
  const pages = source.getPages();

  const documents = await Promise.all(
    pages.map(async (page) => {
      const body = await page.data.getText("processed");
      return `# ${page.data.title}\n\n<!-- ${absolute(page.url)} -->\n\n${body}`;
    }),
  );

  return new Response(documents.join("\n\n---\n\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
