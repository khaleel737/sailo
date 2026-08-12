import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, products, shops } from "@sailo/db/schema";
import { router, shopProcedure } from "./trpc";

const listInput = z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional();

/**
 * The read surface the mobile app opens on: the seller's shop, their catalogue
 * and their latest orders. Every query is scoped by `ctx.shopId` in the WHERE,
 * never by an id the client sends — the same tenant rule the REST handlers hold.
 */
export const appRouter = router({
  shop: router({
    get: shopProcedure.query(({ ctx }) =>
      getDb().query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
    ),
  }),
  products: router({
    list: shopProcedure.input(listInput).query(({ ctx, input }) =>
      getDb().query.products.findMany({
        where: eq(products.shopId, ctx.shopId),
        orderBy: desc(products.createdAt),
        limit: input?.limit ?? 50,
      }),
    ),
  }),
  orders: router({
    list: shopProcedure.input(listInput).query(({ ctx, input }) =>
      getDb().query.orders.findMany({
        where: eq(orders.shopId, ctx.shopId),
        orderBy: desc(orders.createdAt),
        limit: input?.limit ?? 50,
      }),
    ),
  }),
});

export type AppRouter = typeof appRouter;
