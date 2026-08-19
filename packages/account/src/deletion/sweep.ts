import "server-only";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { del, list } from "@vercel/blob";
import { getDb } from "@sailo/db";
import { productFiles, products, shops } from "@sailo/db/schema";

/**
 * The 90-day file sweep. The TODO spec 03 left in `api/cron/sweep`.
 *
 * ─── WHY IT HAD TO SHIP BEFORE SPEC 52 ──────────────────────────────────────
 * `deleteAccountFor` removes a departed seller's images immediately and
 * deliberately keeps their product *files*, because a buyer who paid for a
 * download still holds a live token and taking the file away the moment the
 * seller leaves punishes the wrong person. The cron that finally clears them was
 * a comment. So those files — uploads that can contain anything a seller sold,
 * and that sit in a store we pay for — had **no deletion path at all**, while
 * spec 52 was about to promise buyers a statutory one. Promising erasure on top
 * of a store that cannot erase is worse than not promising it.
 *
 * ─── WHY IT LISTS THE STORE INSTEAD OF READING ROWS ─────────────────────────
 * The TODO describes deleting "the remaining blobs and the `product_files` rows
 * naming them", and that is not quite what is left to work with:
 * `hardDeleteShopContent` deletes `products`, and `product_files` cascades from
 * it. By the time a shop is ninety days dead there is usually **no row naming
 * the blobs at all** — they are unreferenced objects, and nothing in the
 * database can find them.
 *
 * What can find them is their path. `uploadPath` in `@sailo/storage` writes
 * every object to `shops/<shopId>/…`, downloads under `shops/<shopId>/downloads/`,
 * so the store itself is the only complete index of what a dead shop still owns.
 * The sweep lists by prefix and deletes what it finds; any surviving rows are
 * deleted too, and on most shops there are none.
 *
 * That also means it collects the stragglers — an image whose delete call failed
 * on the day, which `deleteBlobs` logs and moves past by design.
 *
 * ─── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 * It does not touch a live shop, and the prefix is built from a `shops.id` read
 * out of the database rather than from anything a caller passes — a sweep that
 * took a prefix argument would be one bad call away from deleting a trading
 * shop's catalogue.
 */

/**
 * How long a dead shop's files outlive it, and why.
 *
 * Ninety days, named here with the reason beside it exactly as
 * `EVIDENCE_RETENTION_DAYS` names four hundred in
 * `packages/core/src/disputes/messages.ts`. The number is a balance between two
 * real people: a buyer who paid for a download last week and still expects to
 * fetch it, and a seller who asked us to delete their account and is entitled to
 * have that mean something. Ninety days is long enough that a normal buyer has
 * finished with the file and short enough that "we deleted your account" is true
 * within a quarter.
 *
 * It is deliberately longer than the ordinary `downloadExpiryDays` a seller sets
 * and shorter than the invoice retention the ledger keeps, because it is about
 * neither: it is about the *bytes*, which are the only part of a closed shop
 * that costs money to keep and the only part that can leak.
 */
export const DELETED_FILE_RETENTION_DAYS = 90;

/** How many dead shops one tick will clear. Bounded so a backlog is paced. */
const SHOPS_PER_RUN = 25;

/** Vercel Blob's own page size for a list call. */
const LIST_PAGE = 1_000;

export type SweepResult = {
  /** Shops whose files were cleared on this tick. */
  shopsSwept: number;
  /** Blob objects deleted. */
  blobsDeleted: number;
  /** `product_files` rows removed — usually zero, see the header. */
  rowsDeleted: number;
};

/**
 * Clear the files of every shop deleted more than ninety days ago.
 *
 * Hourly, idempotent, no request behind it — which is what `api/cron/sweep` is
 * for and why the TODO named it.
 */
export async function sweepDeletedShopFiles(now = new Date()): Promise<SweepResult> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - DELETED_FILE_RETENTION_DAYS * 86_400_000);

  const due = await db
    .select({ id: shops.id })
    .from(shops)
    .where(
      and(
        lt(shops.deletedAt, cutoff),
        isNull(shops.filesSweptAt),
      ),
    )
    .orderBy(shops.deletedAt)
    .limit(SHOPS_PER_RUN);

  let shopsSwept = 0;
  let blobsDeleted = 0;
  let rowsDeleted = 0;

  for (const shop of due) {
    /*
     * The claim, before the work.
     *
     * A conditional UPDATE with the ceiling in the WHERE, not a read then a
     * write: two overlapping ticks both read the same row above, and only the
     * one whose UPDATE matches gets to spend the API calls. The loser skips.
     *
     * Claiming *first* rather than after the delete is deliberate. A tick that
     * dies mid-sweep leaves the shop marked swept with some blobs surviving,
     * which is a bounded leak somebody can clear by hand; claiming afterwards
     * would let two ticks list and delete the same thousand objects, and the
     * second one's deletes race the first one's.
     */
    const [claimed] = await db
      .update(shops)
      .set({ filesSweptAt: now })
      .where(and(eq(shops.id, shop.id), isNull(shops.filesSweptAt)))
      .returning({ id: shops.id });
    if (!claimed) continue;

    shopsSwept += 1;
    blobsDeleted += await deleteShopBlobs(shop.id);
    rowsDeleted += await deleteFileRows(shop.id);
  }

  return { shopsSwept, blobsDeleted, rowsDeleted };
}

/**
 * Every object under `shops/<id>/`, in pages, deleted.
 *
 * Swallows its own failures. A blob we could not delete is a bill rather than a
 * breach, and a store having a bad afternoon must not stop the rest of the
 * sweep — the shop stays marked swept, and the survivors are visible in the log
 * with the shop id on them.
 */
async function deleteShopBlobs(shopId: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;

  try {
    do {
      const page = await list({
        prefix: `shops/${shopId}/`,
        limit: LIST_PAGE,
        cursor,
      });

      const urls = page.blobs.map((blob) => blob.url);
      if (urls.length > 0) {
        await del(urls);
        deleted += urls.length;
      }

      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    console.error(`[sailo] file sweep left blobs behind for shop ${shopId}`, error);
  }

  return deleted;
}

/**
 * Any `product_files` rows that outlived the deletion.
 *
 * Usually none — `products` is hard-deleted and these cascade with it — so this
 * exists for the shop whose deletion crashed between steps and for any future
 * path that keeps the catalogue. Scoped through `products` rather than by a
 * `shopId` this table does not have.
 */
async function deleteFileRows(shopId: string): Promise<number> {
  const db = getDb();

  const owned = db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.shopId, shopId));

  const removed = await db
    .delete(productFiles)
    .where(inArray(productFiles.productId, owned))
    .returning({ id: productFiles.id });

  return removed.length;
}

/**
 * How many shops are waiting, for the /hq system page.
 *
 * A sweep nobody can see the queue of is a sweep that stops running silently —
 * which is how it came to be a TODO in the first place.
 */
export async function pendingFileSweeps(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DELETED_FILE_RETENTION_DAYS * 86_400_000);
  const [row] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(shops)
    .where(and(lt(shops.deletedAt, cutoff), isNull(shops.filesSweptAt)));
  return Number(row?.n ?? 0);
}
