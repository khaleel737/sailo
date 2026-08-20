import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { categories } from "@sailo/db/schema";
import { slugify } from "@sailo/core/slug";
import { firstRow } from "@sailo/core/invariant";
import { publishShopEvent } from "@sailo/events";
import { router, shopProcedure } from "../trpc";
import { byId } from "../shared";

/**
 * How a seller groups their catalogue.
 *
 * Nothing is lifted into a shared package here, and that is a judgement rather
 * than a shortcut. The one piece of real logic — turning a name into a URL
 * segment — is already shared: `slugify` lives in `@sailo/core/slug` and both
 * surfaces call it, so the storefront path a category gets cannot depend on
 * which device created it. What is left is a scoped insert, a scoped delete and
 * a uniqueness check the database already enforces with an index, and a shared
 * module wrapping three of those would be indirection rather than safety.
 *
 * The rule that *is* worth stating: the slug is derived, never sent. A client
 * that could choose one could take a slug that collides with a route on the
 * storefront, and the seller would find out when their category page 404ed.
 */

/** A category name a phone can show in a row without truncating mid-word. */
const nameInput = z.object({ name: z.string().trim().min(1).max(60) });

export const categoriesRouter = router({
  /**
   * In the seller's own order, not alphabetically.
   *
   * `position` is what the storefront renders by, so a list sorted any other
   * way here would show the seller an arrangement they cannot act on — they
   * would reorder row three and watch row six move.
   */
  list: shopProcedure.query(({ ctx }) =>
    getDb().query.categories.findMany({
      where: eq(categories.shopId, ctx.shopId),
      orderBy: [asc(categories.position), asc(categories.name)],
    }),
  ),

  create: shopProcedure.input(nameInput).mutation(async ({ ctx, input }) => {
    const slug = slugify(input.name);
    const db = getDb();

    /*
     * Named rather than left to the unique index. The index refuses it either
     * way, but as a driver error — which reaches the seller as a save that
     * failed with no hint that they already have a category called this. Two
     * different names can slug to the same thing ("T-Shirts" and "t shirts"),
     * so the collision is on the slug, which is what the check asks about.
     */
    const clash = await db.query.categories.findFirst({
      where: and(eq(categories.shopId, ctx.shopId), eq(categories.slug, slug)),
      columns: { id: true },
    });
    if (clash) throw new TRPCError({ code: "CONFLICT", message: "code_taken" });

    /* Appended, never inserted at the front: `position` is the order on the
       storefront, and a new category defaulting to 0 would rearrange a
       catalogue the seller had already arranged. */
    const { max } = firstRow(
      await db
        .select({ max: sql<string>`coalesce(max(${categories.position}), 0)` })
        .from(categories)
        .where(eq(categories.shopId, ctx.shopId)),
      "max aggregate",
    );

    const rows = await db
      .insert(categories)
      .values({ shopId: ctx.shopId, name: input.name, slug, position: Number(max) + 1 })
      .returning({ id: categories.id });

    await publishShopEvent(ctx.shopId, "catalog");
    return { id: rows[0]?.id ?? "", slug };
  }),

  /**
   * Rename one.
   *
   * **The slug moves with the name**, which is a decision with a cost: the
   * storefront URL changes and any link already shared to it stops resolving.
   * It is still the right one — a category called "Winter" whose URL says
   * `summer` is a seller looking at evidence their shop is broken — and the
   * alternative, a slug frozen at creation, is the same problem made permanent.
   */
  rename: shopProcedure
    .input(byId.extend(nameInput.shape))
    .mutation(async ({ ctx, input }) => {
      const slug = slugify(input.name);
      const db = getDb();

      const clash = await db.query.categories.findFirst({
        where: and(
          eq(categories.shopId, ctx.shopId),
          eq(categories.slug, slug),
          ne(categories.id, input.id),
        ),
        columns: { id: true },
      });
      if (clash) throw new TRPCError({ code: "CONFLICT", message: "code_taken" });

      const rows = await db
        .update(categories)
        .set({ name: input.name, slug })
        .where(and(eq(categories.id, input.id), eq(categories.shopId, ctx.shopId)))
        .returning({ id: categories.id });

      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No such category." });

      await publishShopEvent(ctx.shopId, "catalog");
      return { id: input.id, slug };
    }),

  /**
   * Put them in the order the seller dragged them into.
   *
   * The whole list at once rather than one row's new index, because a reorder
   * is one intent: sending "move row 3 to position 1" leaves the server to
   * renumber everything else, and two of those arriving out of order from a
   * phone on a bad connection interleave into an arrangement nobody chose.
   *
   * Ids not in the list are left alone rather than pushed to the end — a client
   * that has a stale page must not be able to bury a category it never saw.
   */
  reorder: shopProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      /*
       * One `db.batch()`, never a driver transaction — neon-http has no
       * transactions and throws on the call, which made every drag-reorder a
       * 500 until this was one. The batch is the only atomicity the driver
       * offers, and it is also one round trip instead of up to two hundred.
       */
      const [head, ...rest] = input.ids.map((id, position) =>
        db
          .update(categories)
          .set({ position })
          .where(and(eq(categories.id, id), eq(categories.shopId, ctx.shopId))),
      );
      if (head) await db.batch([head, ...rest]);

      await publishShopEvent(ctx.shopId, "catalog");
      return { count: input.ids.length };
    }),

  /**
   * Remove one.
   *
   * The products in it are not deleted. `products.categoryId` is `set null` on
   * delete, so they become uncategorised and stay on sale — a seller tidying
   * their groupings must not be able to take their catalogue off the storefront
   * by accident.
   */
  delete: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const rows = await getDb()
      .delete(categories)
      .where(and(eq(categories.id, input.id), eq(categories.shopId, ctx.shopId)))
      .returning({ id: categories.id });

    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No such category." });

    await publishShopEvent(ctx.shopId, "catalog");
    return { id: input.id };
  }),
});
