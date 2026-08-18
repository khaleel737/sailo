import type { MetadataRoute } from "next";
import { docsUrl, isIndexable } from "@/lib/origins";

/**
 * Everything here is meant to be found.
 *
 * Which makes this the shortest `robots.ts` in the repo, and worth saying why:
 * apps/web's has a disallow list because that app serves storefronts, an admin
 * panel and half a dozen routes that carry one-time tokens in the URL. This app
 * serves prerendered pages about a public API and holds no shop's data at all.
 * There is nothing to keep out.
 *
 * The assistant crawlers are named rather than left to `*`. Sailo runs an MCP
 * server and this site is where it is documented — a product making that
 * argument while being invisible to the things it is arguing to has it
 * backwards. Naming them is not merely permission: several are more
 * conservative about an origin that has not addressed them than one that has.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) {
    /*
     * A preview deployment must never outrank production for its own copy, and
     * a docs preview is more exposed to that than most: these pages are almost
     * entirely text, so a preview reads to a crawler as a near-perfect
     * duplicate of the real thing.
     */
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  const allow = ["/"];

  return {
    rules: [
      { userAgent: "*", allow },
      /* Training and retrieval both, deliberately. */
      { userAgent: "GPTBot", allow },
      { userAgent: "OAI-SearchBot", allow },
      { userAgent: "ChatGPT-User", allow },
      { userAgent: "ClaudeBot", allow },
      { userAgent: "Claude-User", allow },
      { userAgent: "Claude-SearchBot", allow },
      { userAgent: "PerplexityBot", allow },
      { userAgent: "Google-Extended", allow },
    ],
    sitemap: docsUrl("/sitemap.xml"),
    host: docsUrl("/"),
  };
}
