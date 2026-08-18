import { defineDocs } from "fumadocs-mdx/macro";
import { loader, type InferPageType } from "fumadocs-core/source";

/**
 * The developer documentation, as a content source.
 *
 * The four pages under `/docs` were four hand-written `page.tsx` files. What
 * they gained here is a sidebar, a per-page table of contents, search and an
 * `llms.txt` — furniture that is tedious to write once and impossible to keep
 * consistent across four files written by hand.
 *
 * **What did not change is the part that matters.** The endpoint table, the
 * tool table and the event list are still rendered from `ENDPOINTS`,
 * `MCP_TOOLS` and `WEBHOOK_EVENTS` — see `components/docs/` — and MDX imports
 * those components rather than restating them in prose. Prose that lists an
 * API by hand is prose that is wrong the first time somebody adds a route, and
 * `rest-contract.test.ts` still fails the build when that happens. Moving to
 * MDX would have been a downgrade if it had cost that gate; it does not.
 *
 * `includeProcessedMarkdown` is what `/llms-full.txt` reads. Without it
 * `page.data.getText("processed")` has nothing to return and the route serves
 * a list of titles with no content under them.
 */
const docs = defineDocs({
  dir: "content/docs",
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export type DocsPage = InferPageType<typeof source>;
