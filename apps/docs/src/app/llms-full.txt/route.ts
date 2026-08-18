import { allPages } from "@/lib/pages";
import { pageAsMarkdown } from "@/lib/llms";

/**
 * `/llms-full.txt` — every page, as one Markdown document.
 *
 * The companion to `/llms.txt`, which lists the pages. This is the pages
 * themselves, in the order the sidebar puts them, so a model given one URL has
 * the whole developer surface in a single fetch rather than thirty.
 *
 * The generated tables are real here, not component names — see `lib/llms.ts`
 * for how, and for why the first version of a route like this is usually worse
 * than nothing.
 */

export const dynamic = "force-static";

export async function GET() {
  const pages = await allPages();
  const documents = await Promise.all(pages.map(pageAsMarkdown));

  return new Response(documents.join("\n\n---\n\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
