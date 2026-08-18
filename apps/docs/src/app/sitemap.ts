import type { MetadataRoute } from "next";
import { allPages } from "@/lib/pages";
import { docsUrl } from "@/lib/origins";

/**
 * Every page, generated from the page map.
 *
 * Not a hand-written list, for the reason `lib/pages.ts` gives at length: a
 * page missing from a sitemap has no symptom. It renders, it is in the sidebar,
 * it is linked from its neighbours — and it is simply not submitted, which on a
 * site whose whole job is to be found by somebody evaluating a product is the
 * one failure that costs something.
 *
 * No `alternates`. These pages exist only in English, unlike the marketing site
 * and the blog, so declaring an hreflang cluster would be claiming translations
 * that are not there. An integration guide half-translated is worse than one
 * honestly in a single language: a mistranslated signature recipe is a verifier
 * that rejects real messages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages = await allPages();

  return pages.map((page) => ({
    url: docsUrl(page.route),
    lastModified: now,
    changeFrequency: "monthly" as const,
    /*
     * The landing page above the rest, and the top-level pages above the
     * reference beneath them. Priority is a weak signal and Google says as
     * much, but the shape it describes here is true: `/` and `/quickstart` are
     * where somebody deciding about Sailo should land, and
     * `/objects/dispute` is where somebody already integrating goes.
     */
    priority: page.route === "/" ? 1 : depthOf(page.route) === 1 ? 0.8 : 0.6,
  }));
}

function depthOf(route: string): number {
  return route.split("/").filter(Boolean).length;
}
