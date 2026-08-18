import { llms } from "fumadocs-core/source";
import { source } from "@/lib/docs-source";

/**
 * `/llms.txt` — the documentation's own index, for a model rather than a
 * crawler.
 *
 * Sailo ships an MCP server. A product whose documentation explains how to
 * point an assistant at it, and which is itself unreadable to one, has the
 * argument backwards — so the same four pages are served here as Markdown with
 * their structure intact, rather than as HTML a model has to strip a sidebar
 * out of.
 *
 * The index only. `/llms-full.txt` beside it carries the prose.
 *
 * Generated from the page tree rather than written down: a file listing the
 * documentation by hand is a file that stops listing all of it the first time
 * somebody adds a page, and nothing goes red.
 */

export function GET() {
  return new Response(llms(source).index(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
