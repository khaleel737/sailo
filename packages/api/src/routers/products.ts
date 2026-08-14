import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { productImages, productVariants, products } from "@sailo/db/schema";
import { router, shopProcedure } from "../trpc";
import { byId, found, listInput } from "../shared";

/** The seller's catalogue, scoped by `ctx.shopId` in every WHERE. */
export const productsRouter = router({
  list: shopProcedure.input(listInput).query(({ ctx, input }) =>
    getDb().query.products.findMany({
      where: eq(products.shopId, ctx.shopId),
      orderBy: desc(products.createdAt),
      limit: input?.limit ?? 50,
    }),
  ),
  /**
   * One product, with everything a detail screen renders in the same round
   * trip — images to show it, variants to price it.
   *
   * The variants come back raw rather than resolved: a blank variant price
   * means "same as the product" and a blank stock means "nobody is
   * counting", and those rules already exist once, in `@sailo/core/variants`.
   * Resolving them here would be a second copy that can disagree with the
   * storefront's.
   */
  get: shopProcedure.input(byId).query(async ({ ctx, input }) =>
    found(
      await getDb().query.products.findFirst({
        where: and(eq(products.id, input.id), eq(products.shopId, ctx.shopId)),
        with: {
          images: { orderBy: asc(productImages.position) },
          variants: { orderBy: asc(productVariants.position) },
        },
      }),
      "product",
    ),
  ),
});
