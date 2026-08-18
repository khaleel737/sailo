import { getPageMap } from "nextra/page-map";
import type { Folder, MdxFile, PageMapItem } from "nextra";

/**
 * Every page on this site, flat, in sidebar order.
 *
 * Three routes need this list — the sitemap, `/llms.txt` and `/llms-full.txt` —
 * and all three would otherwise hard-code it. A hand-kept list of pages is a
 * list that stops being complete the first time somebody adds one, and nothing
 * goes red: the page exists, it is linked from the sidebar, and it is simply
 * absent from the sitemap and invisible to a model. That failure has no
 * symptom, which is why it is worth the fifteen lines here.
 *
 * Sidebar order rather than alphabetical, because `_meta.ts` puts these pages
 * in a deliberate reading order and `/llms-full.txt` is read start to finish.
 * Alphabetising it would open the file on the chargeback guide.
 */

export type DocPage = {
  /** `/webhooks/signatures`, or `/` for the index. */
  route: string;
  title: string;
  description?: string;
};

function isFolder(item: PageMapItem): item is Folder {
  return "children" in item;
}

function isPage(item: PageMapItem): item is MdxFile {
  return "route" in item && !("children" in item);
}

function walk(items: PageMapItem[], into: DocPage[]): void {
  for (const item of items) {
    if (isFolder(item)) {
      walk(item.children, into);
      continue;
    }
    if (!isPage(item)) continue;

    const front = item.frontMatter ?? {};
    into.push({
      route: item.route,
      /*
       * The front matter title, falling back to the file name. A page with no
       * front matter is a mistake rather than a case to support, but a sitemap
       * that threw on one would take the whole build down over a missing line
       * in a Markdown header.
       */
      title: typeof front.title === "string" ? front.title : item.name,
      description: typeof front.description === "string" ? front.description : undefined,
    });
  }
}

export async function allPages(): Promise<DocPage[]> {
  const pages: DocPage[] = [];
  walk(await getPageMap(), pages);

  /*
   * Deduplicated on route. A folder with an `index.mdx` appears both as the
   * folder's own route and as a page inside it, so `/api` would otherwise be
   * listed twice — which a sitemap validator reports as an error.
   */
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (seen.has(page.route)) return false;
    seen.add(page.route);
    return true;
  });
}
