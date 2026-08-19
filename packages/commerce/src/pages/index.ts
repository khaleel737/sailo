import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shopPages, type ShopPage } from "@sailo/db/schema";
import {
  SHOP_PAGE_KINDS,
  SHOP_PAGE_SLUGS,
  type RenderedPage,
  type ShopPageKind,
} from "@sailo/core/shop-pages";

/**
 * The rows behind a seller's hosted documents. Spec 41.
 *
 * The decisions — what a template says, which facts are missing, how an FAQ
 * body is split into rows — are all in `@sailo/core/shop-pages`, which is pure.
 * What is left here is the part that needs a database, and it is deliberately
 * small: five upserts, two reads and a publish.
 *
 * It lives in `@sailo/commerce` rather than in apps/web because the checkout's
 * policy snapshotter is in this package and reads it. `policySnapshotsForOrder`
 * takes the *good* path — snapshotting text that is already ours — only if it
 * can see these rows, and an app cannot be imported from a package.
 */

/** Every page a shop has, whatever its state, in the order the admin lists it. */
export async function shopPagesFor(shopId: string): Promise<ShopPage[]> {
  const rows = await getDb()
    .select()
    .from(shopPages)
    .where(eq(shopPages.shopId, shopId))
    .orderBy(asc(shopPages.kind));

  const order = new Map(SHOP_PAGE_KINDS.map((kind, i) => [kind as string, i]));
  return rows.toSorted(
    (a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99),
  );
}

/** The published set, for the storefront footer, the FAQ and the About block. */
export async function publishedPagesFor(shopId: string): Promise<ShopPage[]> {
  const rows = await getDb()
    .select()
    .from(shopPages)
    .where(and(eq(shopPages.shopId, shopId), eq(shopPages.isPublished, true)));

  const order = new Map(SHOP_PAGE_KINDS.map((kind, i) => [kind as string, i]));
  return rows.toSorted(
    (a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99),
  );
}

/** One published page by slug — the public route's only read. */
export async function publishedPageBySlug(
  shopId: string,
  slug: string,
): Promise<ShopPage | null> {
  const row = await getDb().query.shopPages.findFirst({
    where: and(
      eq(shopPages.shopId, shopId),
      eq(shopPages.slug, slug.toLowerCase()),
      eq(shopPages.isPublished, true),
    ),
  });
  return row ?? null;
}

/** One page by kind, published or not, for the editor and the snapshotter. */
export async function shopPageOfKind(
  shopId: string,
  kind: ShopPageKind,
): Promise<ShopPage | null> {
  const row = await getDb().query.shopPages.findFirst({
    where: and(eq(shopPages.shopId, shopId), eq(shopPages.kind, kind)),
  });
  return row ?? null;
}

/**
 * Write the generated pages, without overwriting a word the seller has written.
 *
 * The rule that makes regeneration safe: **an existing row is never touched
 * here.** A first run creates five rows; a second run creates whatever is
 * missing and leaves the rest exactly as they are. Regenerating a page the
 * seller has edited is `replacePageBody`, which the admin calls only after
 * showing the diff and being told to go ahead.
 *
 * Returns which kinds were created, so the screen can say "three pages added"
 * rather than claiming to have generated five when two already existed.
 */
export async function createMissingPages(
  shopId: string,
  rendered: readonly RenderedPage[],
): Promise<ShopPageKind[]> {
  if (rendered.length === 0) return [];

  const inserted = await getDb()
    .insert(shopPages)
    .values(
      rendered.map((page) => ({
        shopId,
        kind: page.kind,
        slug: SHOP_PAGE_SLUGS[page.kind],
        title: page.title,
        bodyMd: page.bodyMd,
        templateVersion: page.templateVersion,
        source: "generated" as const,
        isPublished: false,
      })),
    )
    /*
     * Nothing on conflict, and no target named. There are two unique indexes on
     * this table — one on (shop, kind) and one on (shop, slug) — and a seller who
     * renamed their refunds page to `returns` and then regenerated would collide
     * on the first and not the second. Naming either would leave the other
     * unhandled and throw where the honest answer is "that page already exists".
     */
    .onConflictDoNothing()
    .returning({ kind: shopPages.kind });

  return inserted.map((row) => row.kind as ShopPageKind);
}

export type SavePageInput = {
  shopId: string;
  kind: ShopPageKind;
  title: string;
  slug: string;
  bodyMd: string;
  isPublished: boolean;
};

/**
 * The seller's own edit.
 *
 * `source` becomes `custom` and `templateVersion` is cleared, because both are
 * claims about where the text came from and neither is true any more. A page
 * still stamped `generated` after a rewrite would appear in the list of shops to
 * migrate when a template is corrected, and the migration would be offered
 * against words nobody generated.
 */
export async function savePage(input: SavePageInput): Promise<void> {
  await getDb()
    .update(shopPages)
    .set({
      title: input.title,
      slug: input.slug.toLowerCase(),
      bodyMd: input.bodyMd,
      source: "custom",
      templateVersion: null,
      isPublished: input.isPublished,
      updatedAt: new Date(),
    })
    .where(and(eq(shopPages.shopId, input.shopId), eq(shopPages.kind, input.kind)));
}

/**
 * Regenerate one page over the seller's version, after they have said yes.
 *
 * Separate from `savePage` so that "overwrite what you wrote" is a distinct call
 * with a distinct caller, rather than the same function with a flag — a flag on
 * a destructive write is a flag that gets defaulted wrong once.
 */
export async function replacePageBody(
  shopId: string,
  page: RenderedPage,
): Promise<void> {
  await getDb()
    .update(shopPages)
    .set({
      title: page.title,
      bodyMd: page.bodyMd,
      source: "generated",
      templateVersion: page.templateVersion,
      updatedAt: new Date(),
    })
    .where(and(eq(shopPages.shopId, shopId), eq(shopPages.kind, page.kind)));
}

/** Publish or unpublish, without touching the body. */
export async function setPagePublished(
  shopId: string,
  kind: ShopPageKind,
  isPublished: boolean,
): Promise<void> {
  await getDb()
    .update(shopPages)
    .set({ isPublished, updatedAt: new Date() })
    .where(and(eq(shopPages.shopId, shopId), eq(shopPages.kind, kind)));
}

/** Whether a slug is already taken by a *different* page of this shop. */
export async function slugTakenBy(
  shopId: string,
  slug: string,
  exceptKind: ShopPageKind,
): Promise<boolean> {
  const rows = await getDb()
    .select({ kind: shopPages.kind })
    .from(shopPages)
    .where(and(eq(shopPages.shopId, shopId), eq(shopPages.slug, slug.toLowerCase())));
  return rows.some((row) => row.kind !== exceptKind);
}

/**
 * The two storefront blocks, read in one pass.
 *
 * `GAP-2026-08-easytools.md` §4.1 refuses the page builder and leaves room for
 * exactly these: an About block and an FAQ accordion. Two known blocks, on or
 * off — not a section editor, which is the thing that was refused.
 */
export async function storefrontSectionsFor(shopId: string): Promise<{
  about: ShopPage | null;
  faq: ShopPage | null;
}> {
  const rows = await getDb()
    .select()
    .from(shopPages)
    .where(
      and(
        eq(shopPages.shopId, shopId),
        eq(shopPages.isPublished, true),
        inArray(shopPages.kind, ["about", "faq"]),
      ),
    );

  return {
    about: rows.find((row) => row.kind === "about") ?? null,
    faq: rows.find((row) => row.kind === "faq") ?? null,
  };
}
