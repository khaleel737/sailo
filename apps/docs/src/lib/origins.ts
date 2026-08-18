import { docsOrigin as configuredDocsOrigin } from "@sailo/core/origin";

/**
 * The two origins this site has to keep straight.
 *
 * They are genuinely different hosts and confusing them is the one mistake that
 * would make these docs actively wrong:
 *
 * - **`appOrigin()`** — from `@sailo/core/origin`. Where the product lives, and
 *   where `/api/v1`, `/api/mcp` and the page that mints a key answer. Every
 *   address printed *inside* a page is this one.
 * - **`docsOrigin()`** — below. Where these pages are served from, and nothing
 *   else. It appears in `metadataBase`, the canonical links, the sitemap and
 *   `robots.txt` — the places where the site has to name itself.
 *
 * Splitting them is not pedantry. `curl https://docs.sailo.store/api/v1/shop`
 * reaches a documentation site that has no such route, and somebody who copies
 * it gets a 404 they will read as "the API is broken".
 */

/**
 * Where *this deployment* is served from.
 *
 * A near-twin of `@sailo/core`'s `docsOrigin`, and the difference is the whole
 * reason it exists: that one answers "where is the documentation" for the rest
 * of the repository, and it is right for it to name production when nothing
 * says otherwise — a link from the seller admin to production's docs is a
 * working link.
 *
 * This one answers "what host am I", and naming production from a preview
 * would be a lie with consequences: the preview would declare
 * `docs.sailo.store` as the canonical for pages that do not exist there yet,
 * and ask Google to index the wrong copy. So a preview falls back to its own
 * Vercel URL, and a `next dev` to localhost.
 *
 * A function rather than a constant, for the reason `appOrigin()` is one: a
 * value computed at module load cannot see an environment a test sets
 * afterwards, and the preview case is exactly the one that would go untested.
 */
export function docsOrigin(): string {
  if (process.env.NEXT_PUBLIC_DOCS_URL) return configuredDocsOrigin();
  if (process.env.VERCEL_ENV === "production") return configuredDocsOrigin();
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3003";
}

/** A path on this site, as an absolute URL. */
export function docsUrl(path: string): string {
  return new URL(path, docsOrigin()).toString();
}

/**
 * Whether this deployment should be indexed.
 *
 * Production only. A preview that let itself be crawled would compete with
 * production for its own copy, and the loser of that is decided by Google.
 */
export function isIndexable(): boolean {
  return !process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production";
}
