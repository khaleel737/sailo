import type { MetadataRoute } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { absolute } from "@/lib/seo";

/**
 * The public surface: the marketing page, every published shop and every
 * published product in one.
 *
 * Revalidated daily rather than per request — a sitemap that runs two queries
 * on every crawler hit is a denial-of-service vector with a friendly name, and
 * a new shop appearing within a day is soon enough for any search engine.
 */
export const revalidate = 86_400;

/** Google ignores anything past 50,000 URLs, and Sailo is nowhere near that. */
const MAX_PRODUCTS = 20_000;

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

    const products = await db
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
      .limit(MAX_PRODUCTS);

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
  } catch {
    // A sitemap is a nicety; the site is not. Serve what needs no database
    // rather than returning a 500 that tells a crawler the whole site is down.
    return staticRoutes;
  }
}
