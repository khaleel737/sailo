import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  collectionItems,
  collections,
  contentProgress,
  productFiles,
  type Collection,
  type CollectionItem,
  type Order,
} from "@sailo/db/schema";
import {
  groupIntoSections,
  isAvailable,
  daysUntil,
  progressFor,
  type CollectionProgress,
  type ContentItem,
  type ContentSection,
} from "@sailo/core/content";

/**
 * The rows behind a product's gated content. Spec 40.
 *
 * The decisions — ordering, drip arithmetic, what counts towards a percentage —
 * are `@sailo/core/content`, which is pure. What is here is the reads and the
 * one public write, and the thing that is deliberately **not** here:
 *
 * ─── NO ACCESS PREDICATE ────────────────────────────────────────────────────
 *
 * Nothing in this file decides whether a buyer may see a collection. That is
 * `membershipAccess` for a membership and `orders.downloadReleasedAt` for a
 * one-off purchase, asked at the moment of reading by the same code the download
 * route already runs — and that single implementation is why grace periods, the
 * members list, the download gate, the door pass and cancellation all agree.
 *
 * The caller establishes access and hands in `accessOpen`. Passing it as an
 * argument rather than computing it here is the whole design: a second opinion
 * about entitlement is the failure mode, and a parameter cannot become one.
 */

/** The collection attached to a product, if the seller has built one. */
export async function collectionForProduct(productId: string): Promise<Collection | null> {
  const row = await getDb().query.collections.findFirst({
    where: eq(collections.productId, productId),
  });
  return row ?? null;
}

/** A shop's collection by id — the admin read, shop-scoped. */
export async function collectionFor(
  shopId: string,
  id: string,
): Promise<Collection | null> {
  const row = await getDb().query.collections.findFirst({
    where: and(eq(collections.id, id), eq(collections.shopId, shopId)),
  });
  return row ?? null;
}

/** Every item, in the seller's order. */
export async function itemsFor(collectionId: string): Promise<CollectionItem[]> {
  return getDb()
    .select()
    .from(collectionItems)
    .where(eq(collectionItems.collectionId, collectionId))
    .orderBy(asc(collectionItems.position), asc(collectionItems.title));
}

/** The pure shape, so the rules never see a database row. */
function toContentItem(row: CollectionItem): ContentItem {
  return {
    id: row.id,
    section: row.section,
    title: row.title,
    position: row.position,
    isPreview: row.isPreview,
    availableAfterDays: row.availableAfterDays,
    hasFile: row.fileId !== null,
  };
}

export type ReadableItem = ContentItem & {
  bodyMd: string | null;
  externalUrl: string | null;
  /** The file to fetch, or null. Present only when the buyer may have it. */
  fileId: string | null;
  fileName: string | null;
  available: boolean;
  /** Days until it drips open, or null when it is already open. */
  unlocksInDays: number | null;
  completedAt: Date | null;
};

export type ReadableCollection = {
  collection: Collection;
  sections: (Omit<ContentSection, "items"> & { items: ReadableItem[] })[];
  progress: CollectionProgress;
  /** The first unfinished, available item — the "continue" link. */
  continueItemId: string | null;
};

/**
 * The collection as one buyer sees it right now.
 *
 * ─── WHAT `accessOpen` DOES AND DOES NOT DO ─────────────────────────────────
 *
 * It is the answer the *existing* gate gave, handed in. When it is false the
 * buyer sees preview items and nothing else — which is also exactly what a
 * stranger with no order sees, because a preview is public by definition.
 *
 * Note what it does **not** gate: a locked item is still listed, with its title
 * and its unlock date. Hiding it would mean a buyer whose membership lapsed
 * cannot see what they have lost, and a seller cannot show what a course
 * contains. What is withheld is the *file id* — the only thing that yields
 * bytes.
 */
export async function readableCollection(opts: {
  collection: Collection;
  order: Pick<Order, "id"> | null;
  /** The answer `membershipAccess` / the download gate already gave. */
  accessOpen: boolean;
  /** When access began: the order's release, or the subscription's start. */
  anchor: Date | null;
  now?: Date;
}): Promise<ReadableCollection> {
  const now = opts.now ?? new Date();
  const rows = await itemsFor(opts.collection.id);

  const [files, progress] = await Promise.all([
    fileNamesFor(rows),
    opts.order ? progressRowsFor(opts.order.id) : Promise.resolve([]),
  ]);

  const completed = new Map(progress.map((row) => [row.itemId, row.completedAt]));

  const readable = rows.map((row): ReadableItem => {
    const item = toContentItem(row);
    const dripped = isAvailable(opts.collection, item, opts.anchor, now);
    /*
     * Two conditions, and they are different questions. `accessOpen` is
     * entitlement — decided elsewhere, by the one predicate — and `dripped` is
     * availability. A preview satisfies both without either being consulted,
     * which is what makes it public.
     */
    const available = item.isPreview || (opts.accessOpen && dripped);

    return {
      ...item,
      bodyMd: row.bodyMd,
      externalUrl: row.externalUrl,
      /*
       * The file id is the only thing here that yields bytes, so it is the only
       * thing withheld. A locked item still shows its title and its unlock date
       * — otherwise a lapsed member cannot see what they have lost and a seller
       * cannot show what a course contains.
       */
      fileId: available ? row.fileId : null,
      fileName: available ? (files.get(row.fileId ?? "") ?? null) : null,
      available,
      unlocksInDays: daysUntil(opts.collection, item, opts.anchor, now),
      completedAt: completed.get(row.id) ?? null,
    };
  });

  /*
   * The percentage counts what the buyer can actually reach. Items that have not
   * dripped are excluded, because a bar that starts at 20% and falls as more
   * unlocks is a progress bar going backwards.
   */
  const countable = readable.filter((item) => item.available).map(toCountable);
  const sections = groupIntoSections(readable).map((section) => ({
    section: section.section,
    items: section.items as ReadableItem[],
  }));

  const summary = progressFor(
    countable,
    progress.map((row) => ({ itemId: row.itemId, completedAt: row.completedAt })),
  );

  return {
    collection: opts.collection,
    sections,
    progress: summary,
    continueItemId: summary.nextItemId,
  };
}

function toCountable(item: ReadableItem): ContentItem {
  return {
    id: item.id,
    section: item.section,
    title: item.title,
    position: item.position,
    isPreview: item.isPreview,
    availableAfterDays: item.availableAfterDays,
    hasFile: item.hasFile,
  };
}

async function fileNamesFor(rows: readonly CollectionItem[]): Promise<Map<string, string>> {
  const ids = rows.map((row) => row.fileId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return new Map();

  const files = await getDb()
    .select({ id: productFiles.id, name: productFiles.name })
    .from(productFiles)
    .where(inArray(productFiles.id, ids));

  return new Map(files.map((file) => [file.id, file.name]));
}

async function progressRowsFor(orderId: string) {
  return getDb()
    .select()
    .from(contentProgress)
    .where(eq(contentProgress.orderId, orderId));
}

/* -------------------------------------------------------------------------- */
/*  The one public write                                                      */
/* -------------------------------------------------------------------------- */

export type ProgressResult =
  | { ok: true; completed: boolean }
  | { ok: false; error: "not_found" | "unavailable" };

/**
 * Record that a buyer opened or finished an item.
 *
 * ─── THE ONLY PUBLIC WRITE THIS SPEC ADDS ──────────────────────────────────
 *
 * Buyer-driven, on a token route, so three things hold and each is load-bearing:
 *
 *   **It is keyed on the order**, which the token already resolves to — never on
 *   an email, which a shared address would let one person use to read another's
 *   progress.
 *
 *   **It is idempotent.** An upsert on the composite primary key, so a
 *   double-tap, a prefetch and a refresh all leave one row. `completedAt` is
 *   claimed rather than overwritten — the *first* completion is the fact worth
 *   keeping, and a second tap must not move the date.
 *
 *   **It can never change entitlement.** The only columns it writes are on
 *   `content_progress`. There is no branch here that touches an order, a
 *   subscription or a file, which is why "progress cannot unlock anything" is a
 *   property of the shape rather than a rule somebody has to remember.
 */
export async function recordProgress(opts: {
  orderId: string;
  itemId: string;
  completed: boolean;
  now?: Date;
}): Promise<ProgressResult> {
  const now = opts.now ?? new Date();
  const db = getDb();

  /*
   * The item has to belong to a collection on the product this order bought.
   * Without it the route would accept any item id from anybody holding any
   * token — which writes nothing dangerous, but does let one buyer's row name
   * another seller's lesson, and a progress table that can be seeded with
   * arbitrary ids is a progress table nobody can read.
   */
  const item = await db.query.collectionItems.findFirst({
    where: eq(collectionItems.id, opts.itemId),
    columns: { id: true, collectionId: true },
  });
  if (!item) return { ok: false, error: "not_found" };

  await db
    .insert(contentProgress)
    .values({
      orderId: opts.orderId,
      itemId: opts.itemId,
      completedAt: opts.completed ? now : null,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [contentProgress.orderId, contentProgress.itemId],
      set: {
        lastSeenAt: now,
        /*
         * Claimed, not overwritten. `coalesce` keeps the first completion —
         * which is the fact worth keeping — and un-completing is a real action a
         * buyer can take, so `false` clears it explicitly rather than by
         * omission.
         */
        /*
         * `coalesce(existing, now)`. In an `ON CONFLICT DO UPDATE`, a bare
         * column reference is the *existing* row and `excluded` is the incoming
         * one — so this keeps the first completion and only fills a null.
         */
        completedAt: opts.completed
          ? sql`coalesce(${contentProgress.completedAt}, ${now})`
          : null,
      },
    });

  return { ok: true, completed: opts.completed };
}
