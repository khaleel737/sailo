import "server-only";
import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  productFiles,
  productImages,
  productVariants,
  products,
} from "@sailo/db/schema";

/**
 * Reading a seller's own catalogue, once, for every surface that shows it.
 *
 * WHAT WAS ACTUALLY DUPLICATED
 *
 * Three reads existed and only two of them were the same read:
 *
 *   - `apps/web/src/lib/queries/products.ts` → `getAdminProducts`, which loads
 *     the whole catalogue up to a ceiling because the admin renders it as one
 *     drag-orderable list.
 *   - `packages/api/src/routers/products.ts` → `products.list`, which
 *     keyset-pages fifty at a time because a phone scrolls.
 *   - the same two files' `getAdminProduct` / `products.get`, loading one
 *     product for an editor. Those two *were* the same query written twice.
 *
 * The pagination difference is real and is not collapsed here: a list you can
 * drag to reorder cannot be a page you scroll off the end of, and a phone
 * cannot hold a thousand rows. What was dangerous is everything *around* it —
 * the shop scope, the status filter, the search predicate and the relation set
 * — because those are the parts that decide whether the phone and the browser
 * are looking at the same catalogue at all.
 *
 * So the predicate and the shape live here and the two callers keep their own
 * ordering and limit. `sellerScope` in particular is the security-relevant one:
 * every read is `and(eq(shopId), …)`, and no shape of caller input can remove
 * that first term because callers do not build it.
 */

/**
 * Everything a product row is shown with.
 *
 * Written as functions rather than shared object literals because drizzle infers
 * the result type from the literal at each call site — a hoisted `as const`
 * object makes `orderBy` readonly and the query builder rejects it, and a
 * ternary between two shapes widens to a union it cannot accept either.
 */
const listRelations = () => ({
  images: { orderBy: [asc(productImages.position)] },
  variants: { orderBy: [asc(productVariants.position)] },
});

export type SellerCatalogueFilter = {
  /** Published, draft, or both. Absent means both. */
  status?: "published" | "draft";
  /** A title or slug substring. A filter on top of the shop scope, never instead of it. */
  search?: string;
};

/**
 * The WHERE every seller-facing catalogue read is built from.
 *
 * `shopId` first and unconditionally. A caller passing a filter cannot widen
 * the scope, because the scope is not one of the things it passes — which is
 * the difference between a filter and an authorisation bug.
 *
 * `extra` is for a caller's own additional term, which today is only the keyset
 * cursor. It is `and`-ed on, so it can narrow and never broaden.
 */
export function sellerScope(
  shopId: string,
  filter: SellerCatalogueFilter = {},
  extra?: SQL | undefined,
): SQL | undefined {
  const search = filter.search?.trim();
  return and(
    eq(products.shopId, shopId),
    filter.status === "published" ? eq(products.isPublished, true) : undefined,
    filter.status === "draft" ? eq(products.isPublished, false) : undefined,
    search
      ? or(ilike(products.title, `%${search}%`), ilike(products.slug, `%${search}%`))
      : undefined,
    extra,
  );
}

/**
 * One page of the catalogue, newest first, for a caller that pages by cursor.
 *
 * The ordering is both halves of the key — `createdAt` then `id` — because a
 * cursor cannot resume a tie on a timestamp alone, and two products saved in
 * the same second is ordinary rather than rare.
 *
 * Returns `limit + 1` rows so the caller can tell a full page from the last
 * one without a second count query. `pageOf` in `../pagination` trims it.
 */
export function sellerCataloguePage(opts: {
  shopId: string;
  filter?: SellerCatalogueFilter;
  /** The keyset term from `olderThan(products, decodeCursor(cursor))`. */
  after?: SQL | undefined;
  limit: number;
}) {
  return getDb().query.products.findMany({
    where: sellerScope(opts.shopId, opts.filter, opts.after),
    orderBy: [desc(products.createdAt), desc(products.id)],
    limit: opts.limit + 1,
  });
}

/**
 * The whole catalogue in the seller's own order, up to a ceiling.
 *
 * `position` first, because this is the list the admin lets a seller drag to
 * reorder — a page of it would make "move this to the top" mean nothing.
 *
 * The ceiling is a backstop against one shop taking the admin down, not
 * pagination, and the caller is expected to say so rather than render a
 * truncated count as the whole catalogue. That mistake was made once: a shop
 * with five hundred products was told it had two hundred and could not find the
 * rest, which is worse than a slow page because a slow page tells you something
 * is wrong.
 */
export function sellerCatalogue(opts: {
  shopId: string;
  filter?: SellerCatalogueFilter;
  limit: number;
}) {
  return getDb().query.products.findMany({
    where: sellerScope(opts.shopId, opts.filter),
    orderBy: [asc(products.position), desc(products.createdAt)],
    limit: opts.limit,
    /*
     * `category` unconditionally rather than behind a flag. A flag reads as
     * the more flexible design and is worse here: drizzle infers the result
     * type from this literal, so a runtime ternary widens it to a union and
     * `product.category` stops existing for the caller that asked for it.
     *
     * There is no cost to always joining it — the only caller is the admin
     * list, which shows it. A caller that genuinely does not want relations
     * wants `sellerCataloguePage`, which loads none.
     */
    with: { ...listRelations(), category: true },
  });
}

/**
 * One product, with everything an editor round-trips.
 *
 * This is the read that genuinely was written twice — once for the admin form
 * and once for the phone's product screen — and the two had already drifted:
 * the phone's omitted `files`, so a digital product opened on a phone and saved
 * would have been saved with no downloads attached had the editor not been
 * writing them separately.
 *
 * Null rather than a throw. The tRPC router turns it into a `NOT_FOUND` and the
 * admin route calls `notFound()`, and those are different answers to the same
 * absence.
 */
export function sellerProduct(shopId: string, id: string) {
  return getDb()
    .query.products.findFirst({
      where: and(eq(products.id, id), eq(products.shopId, shopId)),
      /* The editor needs the downloadable files too; a list never renders them. */
      with: {
        ...listRelations(),
        files: { orderBy: [asc(productFiles.position)] },
      },
    })
    .then((row) => row ?? null);
}
