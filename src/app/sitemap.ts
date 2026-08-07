import type { MetadataRoute } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { absolute } from "@/lib/seo";
import { getContentLocales, getEveryArticleByLocale } from "@/lib/blog";

/**
 * The public surface: the marketing page, every published shop and every
 * published product in one.
 *
 * Refreshed on a schedule rather than per request — a sitemap that runs two
 * queries on every crawler hit is a denial-of-service vector with a friendly
 * name. The window below is the backstop; `/api/cron/sitemap` is what actually
 * drives the refresh each night, so the file is already current by the time a
 * crawler asks for it.
 */
export const revalidate = 86_400;

/**
 * Google reads 50,000 URLs per sitemap and no further. Everything here shares
 * that one budget, so the products are capped by whatever the shops leave
 * rather than by a second fixed number that could combine with them to
 * overshoot.
 */
const MAX_URLS = 50_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absolute("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    // /login and /signup are deliberately absent: robots.ts disallows them, and
    // submitting a blocked URL in a sitemap is a Search Console error rather
    // than a ranking.
    // Indexable on purpose. A payment provider or a cautious buyer looking for
    // these should find them without being signed in.
    { url: absolute("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: absolute("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: absolute("/refunds"), lastModified: now, changeFrequency: "yearly", priority: 0.4 },
  ];

  /*
   * One index per language, at its own URL.
   *
   * `/blog` itself is deliberately absent: it redirects to whichever language
   * the reader prefers, so it has no content of its own to offer a crawler and
   * submitting a redirect is a Search Console warning rather than a ranking.
   */
  for (const locale of await getContentLocales()) {
    staticRoutes.push({
      url: absolute(`/${locale}/blog`),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  /*
   * Articles come off disk, not out of the database, so they belong outside
   * the try/catch below — a database outage should not take the blog out of
   * the sitemap along with the shops.
   *
   * Every language, each at its own locale-prefixed URL. That prefix is the
   * whole reason these are worth submitting: a French article at `/fr/blog/...`
   * is a French page a crawler can index as French, where the previous single
   * cookie-switched URL per slug could only ever be indexed once.
   */
  for (const { locale, article } of await getEveryArticleByLocale()) {
    staticRoutes.push({
      url: absolute(`/${locale}/blog/${article.slug}`),
      lastModified: new Date(article.date),
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  try {
    const db = getDb();

    const shops = await db
      .select({
        handle: schema.shops.handle,
        updatedAt: schema.shops.updatedAt,
      })
      .from(schema.shops)
      .where(eq(schema.shops.isPublished, true));

    const publishedHandles = new Map(shops.map((s) => [s.handle, s.updatedAt]));

    // Whatever is left of the 50,000 once the shops have had theirs. Ordered
    // newest first, so if a fleet ever does overrun the budget it is the
    // stalest products that fall off rather than an arbitrary slice.
    const budget = Math.max(0, MAX_URLS - staticRoutes.length - shops.length);

    const products =
      budget === 0
        ? []
        : await db
            .select({
              handle: schema.shops.handle,
              slug: schema.products.slug,
              updatedAt: schema.products.updatedAt,
            })
            .from(schema.products)
            .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
            .where(
              and(
                eq(schema.products.isPublished, true),
                eq(schema.shops.isPublished, true),
              ),
            )
            .orderBy(desc(schema.products.updatedAt))
            .limit(budget);

    if (budget > 0 && products.length === budget) {
      // Landing exactly on the cap almost certainly means there were more.
      // Silent truncation reads identically to "there are no more pages", so
      // say it where a deploy log will catch it.
      console.warn(
        `[sitemap] hit the ${budget}-URL product budget; some products are unlisted. Split with generateSitemaps.`,
      );
    }

    return [
      ...staticRoutes,
      ...shops.map((shop) => ({
        url: absolute(`/${shop.handle}`),
        lastModified: shop.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
      ...products
        // A product whose shop was unpublished between the two reads would
        // otherwise be advertised as live.
        .filter((product) => publishedHandles.has(product.handle))
        .map((product) => ({
          url: absolute(`/${product.handle}/p/${product.slug}`),
          lastModified: product.updatedAt,
          changeFrequency: "weekly" as const,
          priority: 0.6,
        })),
    ];
  } catch (error) {
    /*
     * Swallow this during the build only.
     *
     * A build has no previous sitemap to fall back on, and failing a deploy
     * because the database blinked is the wrong trade — four static URLs is a
     * fine starting point, and that night's cron replaces it.
     *
     * At refresh time the opposite holds. Next keeps serving the last good copy
     * while it regenerates, so throwing costs a crawler nothing and leaves the
     * real sitemap up. Returning the short list here would instead cache a
     * four-URL sitemap for a full day over a few seconds of database trouble,
     * turning a blip into an SEO outage.
     */
    if (process.env.NEXT_PHASE === "phase-production-build") {
      console.warn("[sitemap] no database during build; shipping static routes only", error);
      return staticRoutes;
    }
    throw error;
  }
}
