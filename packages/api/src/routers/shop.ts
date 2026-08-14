import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { router, shopProcedure } from "../trpc";

/**
 * The shop the caller signed in as.
 *
 * One read today. It stays its own file because "who am I looking at" is the
 * question every other router's `ctx.shopId` is the answer to, and because the
 * shop's own settings — hours, payment rails, socials — land here rather than
 * being bolted onto whichever router happened to be open.
 */
export const shopRouter = router({
  get: shopProcedure.query(({ ctx }) =>
    getDb().query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
  ),
});
