/**
 * The uploaded objects, which no row deletion touches.
 *
 * Separated because `isBlobUrl` is a hostname guard that no test could reach:
 * `collectBlobUrls` sat between it and every caller, and that needs a database. It is
 * exported and asserted directly now, lookalike hostnames included.
 */

import "server-only";
import { eq, inArray } from "drizzle-orm";
import { del } from "@vercel/blob";
import { getDb } from "@sailo/db";
import { productFiles, productImages, productVariants, products } from "@sailo/db/schema";

/** The host every Vercel Blob object is served from. */
export const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

/**
 * Whether this stored URL names an object we could plausibly delete.
 *
 * Deliberately *not* the same question as `isStoredFileUrl` in
 * `apps/web/src/lib/file-urls.ts`, and not a copy of it. That one guards a
 * server-side fetch against SSRF and therefore has to be strict about which
 * store the URL belongs to; this one only decides what to hand `del()`, and
 * `del()` is already scoped to our own store by `BLOB_READ_WRITE_TOKEN` — it
 * cannot reach another account's objects however this answers.
 *
 * So the job here is narrower: skip the nulls, and skip the seeded demo
 * images on picsum and unsplash, which are not ours and would each cost a
 * failed API call on the way out.
 */
export function isBlobUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Every blob this shop owns, split by what happens to it.
 *
 * `orderItems.imageUrl` deliberately is not collected: those rows are ledger
 * and survive, and their thumbnails are the same objects as the product
 * images. Removing them leaves past receipts with a broken image, which is
 * the accepted cost of not keeping a deleted seller's photographs forever.
 */
export async function collectBlobUrls(
  shopId: string,
  avatarUrl: string | null,
  logoUrl: string | null,
): Promise<{ images: string[]; files: string[] }> {
  const db = getDb();

  const shopProducts = db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.shopId, shopId));

  const [images, variantImages, files] = await Promise.all([
    db
      .select({ url: productImages.url })
      .from(productImages)
      .where(inArray(productImages.productId, shopProducts)),
    db
      .select({ url: productVariants.imageUrl })
      .from(productVariants)
      .where(inArray(productVariants.productId, shopProducts)),
    db
      .select({ url: productFiles.url })
      .from(productFiles)
      .where(inArray(productFiles.productId, shopProducts)),
  ]);

  return {
    images: [
      ...images.map((r) => r.url),
      ...variantImages.map((r) => r.url),
      avatarUrl,
      logoUrl,
    ].filter(isBlobUrl),
    files: files.map((r) => r.url).filter(isBlobUrl),
  };
}

/** Best effort, one call, failures logged — never fails the deletion. */
export async function deleteBlobs(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  try {
    await del(urls);
  } catch (error) {
    console.error(
      `[sailo] ${urls.length} blob(s) survived an account deletion`,
      error,
    );
  }
}
