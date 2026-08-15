import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products, reviews } from "@sailo/db/schema";
import { publishShopEvent } from "@sailo/events";
import { router, shopProcedure } from "../trpc";
import { byId } from "../shared";

/**
 * Moderation, which is the whole of what a seller does with reviews.
 *
 * A review arrives from a buyer through a public form and lands unapproved —
 * `submitReview` in apps/web owns that path and stays there, because it is
 * rate-limited by caller IP and reached without a session. Nothing here writes
 * a review; these three procedures decide whether one is shown.
 *
 * That asymmetry is why nothing was lifted into a shared package. The *seller's*
 * half is a scoped update and a scoped delete with no rule in either — the only
 * judgement is `isApproved` defaulting to false at the point of submission, and
 * that judgement is in the column's own default where neither surface can
 * forget it.
 *
 * Approval is the thing worth being careful about, and the care is in the
 * WHERE: a review belongs to a shop *and* to a product, and approving by id
 * alone would let a client publish a review that was written about somebody
 * else's shop.
 */

const listInput = z
  .object({
    /**
     * What to show. Defaults to what needs the seller — the screen exists
     * because something is waiting, and opening it on everything they have
     * ever approved buries the two rows they came for.
     */
    status: z.enum(["pending", "approved", "all"]).default("pending"),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .optional();

export const reviewsRouter = router({
  /**
   * The shop's reviews, newest first, with the product each one is about.
   *
   * The product's title comes back with the row rather than being fetched per
   * review by the client. A moderation queue is unreadable without it — "4
   * stars, 'lovely'" is not something a seller can approve or reject without
   * knowing what it is about — and thirty rows would otherwise be thirty
   * follow-up requests from a phone.
   */
  list: shopProcedure.input(listInput).query(async ({ ctx, input }) => {
    const status = input?.status ?? "pending";

    const rows = await getDb()
      .select({
        id: reviews.id,
        authorName: reviews.authorName,
        rating: reviews.rating,
        body: reviews.body,
        isApproved: reviews.isApproved,
        createdAt: reviews.createdAt,
        productId: reviews.productId,
        productTitle: products.title,
      })
      .from(reviews)
      .innerJoin(products, eq(products.id, reviews.productId))
      .where(
        and(
          eq(reviews.shopId, ctx.shopId),
          status === "all" ? undefined : eq(reviews.isApproved, status === "approved"),
        ),
      )
      .orderBy(desc(reviews.createdAt))
      .limit(input?.limit ?? 50);

    return rows;
  }),

  /**
   * How many are waiting, for the badge on the way in.
   *
   * Its own procedure rather than `list().length`, because a badge must not
   * depend on a page: a seller with sixty pending reviews and a limit of fifty
   * would be shown "50" for as long as it took them to work through ten.
   */
  pending: shopProcedure.query(async ({ ctx }) => {
    const rows = await getDb()
      .select({ total: count() })
      .from(reviews)
      .where(and(eq(reviews.shopId, ctx.shopId), eq(reviews.isApproved, false)));

    return { pending: Number(rows[0]?.total ?? 0) };
  }),

  /** Publish one. Scoped by shop in the WHERE, never by the id alone. */
  approve: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const rows = await getDb()
      .update(reviews)
      .set({ isApproved: true })
      .where(and(eq(reviews.id, input.id), eq(reviews.shopId, ctx.shopId)))
      .returning({ id: reviews.id });

    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No such review." });

    /* The storefront caches the catalogue per shop, and an approved review is
       part of what a product page renders. */
    await publishShopEvent(ctx.shopId, "review");
    return { id: input.id };
  }),

  /**
   * Remove one.
   *
   * A delete rather than a "rejected" flag, and that is the honest shape: there
   * is nothing a seller would ever do with a queue of things they have already
   * decided against, and keeping the row would mean the buyer's name and words
   * sit in the database forever because somebody once clicked no.
   */
  delete: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const rows = await getDb()
      .delete(reviews)
      .where(and(eq(reviews.id, input.id), eq(reviews.shopId, ctx.shopId)))
      .returning({ id: reviews.id });

    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No such review." });

    await publishShopEvent(ctx.shopId, "review");
    return { id: input.id };
  }),
});
