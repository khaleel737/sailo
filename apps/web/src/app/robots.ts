import type { MetadataRoute } from "next";
import { absolute, appOrigin } from "@sailo/core/origin";

/**
 * Storefronts and the marketing page are meant to be found. Everything behind
 * a login, a one-time token or an API route is not — and several of those
 * paths carry tokens in the URL, so keeping crawlers out is a privacy measure
 * rather than a tidiness one.
 */
export default function robots(): MetadataRoute.Robots {
  // A preview deployment must never outrank production for its own copy.
  const indexable =
    !process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production";

  if (!indexable) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  /*
   * `/api/` is closed to everyone, with one exception carved back out.
   *
   * `Allow` beats `Disallow` on a longer match in every crawler that
   * implements the standard, so naming the path individually is what keeps the
   * blanket rule honest rather than having to loosen it.
   *
   * `/api/v1/openapi.json` is the machine-readable REST contract: public,
   * unauthenticated, no shop's data behind it, and a spec nobody can fetch is
   * a spec nobody evaluates.
   *
   * It used to be three. `/llms.txt` and `/llms-full.txt` were the developer
   * documentation as Markdown, and they left with the pages they describe —
   * docs.sailo.store serves both now, and has its own `robots.ts` saying so.
   *
   * The rest of `/api/` stays shut. Those routes carry shop data behind a
   * bearer token, and several take one-time tokens in the URL.
   */
  const shared = {
    allow: ["/", "/api/v1/openapi.json"],
    disallow: [
      "/admin",
      "/api/",
      "/onboarding",
      "/login",
      "/signup",
      "/partner/",
      "/invoice/",
      "/download/",
    ],
  };

  return {
    rules: [
      { userAgent: "*", ...shared },
      /*
       * The assistant crawlers, named rather than left to `*`.
       *
       * Sailo runs an MCP server and documents how to point Claude, Cursor or
       * ChatGPT at a shop. A product making that argument while being invisible
       * to the things it is arguing to has it backwards — and the default here
       * is not neutral: several of these agents are more conservative about an
       * unnamed origin than about one that has addressed them.
       *
       * Two kinds, deliberately both. `GPTBot` and `ClaudeBot` collect for
       * training; `OAI-SearchBot`, `ChatGPT-User`, `Claude-User`,
       * `PerplexityBot` and `Google-Extended` are what fetches a page to answer
       * somebody's question *now*, which is the one that decides whether an
       * assistant can tell a developer that Sailo has a REST API.
       *
       * The same allow/disallow as everyone else. Nothing here opens a door
       * that is shut to a browser — an agent that follows a link into `/admin`
       * still finds a login, and this only spares it the fetch.
       */
      ...AI_AGENTS.map((userAgent) => ({ userAgent, ...shared })),
    ],
    sitemap: absolute("/sitemap.xml"),
    host: appOrigin(),
  };
}

/**
 * The crawlers worth naming, and what each one is for.
 *
 * Kept as a list rather than inlined so that adding one is a one-line diff with
 * somewhere to say why. A user agent that is not here is not blocked — it falls
 * through to the `*` rule, which already allows everything public.
 */
const AI_AGENTS = [
  // OpenAI: training, search index, and the live fetch behind a ChatGPT answer.
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  // Anthropic: the same split.
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  // Perplexity, Google's AI surfaces, and Common Crawl, which feeds many others.
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "CCBot",
  // Meta, Apple, Amazon and Mistral.
  "meta-externalagent",
  "Applebot-Extended",
  "Amazonbot",
  "MistralAI-User",
] as const;
