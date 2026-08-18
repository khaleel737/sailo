import { allPages } from "@/lib/pages";
import { indexDocument } from "@/lib/llms";

/**
 * `/llms.txt` — this site's own index, for a model rather than a crawler.
 *
 * Sailo ships an MCP server. A product whose documentation explains how to
 * point an assistant at it, and which is itself unreadable to one, has the
 * argument backwards.
 *
 * The index only; `/llms-full.txt` beside it carries the prose. Both are
 * generated from the page map rather than written down, because a file listing
 * the documentation by hand stops listing all of it the first time somebody
 * adds a page — and nothing goes red.
 */

/*
 * Built once, at build time. Every page it reads is prerendered from constants
 * compiled into the bundle, so there is nothing a per-request build could see
 * that this one cannot.
 */
export const dynamic = "force-static";

export async function GET() {
  return new Response(indexDocument(await allPages()), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
