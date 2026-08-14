import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { pushTokens, shops } from "@sailo/db/schema";
import { router, shopProcedure } from "../trpc";
import { found, pushToken } from "../shared";

/**
 * Where to reach this seller's phone.
 *
 * `shopProcedure` like everything else here, even though the row it writes is
 * keyed on the *user*. That is not a loophole in the shop-scoping rule, it is
 * the rule applied one step further: the client sends a device token and
 * nothing else, and the account it gets filed under is read from the shop the
 * session already resolved to. There is no input a caller could put a
 * different person's id into, which is the property that matters — the same
 * one the `eq(..., ctx.shopId)` predicates hold for every read elsewhere.
 */
export const pushRouter = router({
  /**
   * Announce this device. Called on every launch the app has permission for,
   * so it must be safe to call repeatedly — hence an upsert rather than a
   * check-then-insert, which would race two launches into two rows.
   *
   * The conflict target is the token alone, so a handset that changes hands
   * *moves* to the new seller instead of accumulating a second row. See the
   * note on the unique index in `@sailo/db/schema/push`: without that, the
   * previous seller's orders would keep arriving on a phone they no longer
   * have.
   */
  register: shopProcedure
    .input(z.object({ token: pushToken, platform: z.enum(["ios", "android"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const shop = found(
        await db.query.shops.findFirst({
          where: eq(shops.id, ctx.shopId),
          columns: { userId: true },
        }),
        "shop",
      );

      await db
        .insert(pushTokens)
        .values({
          userId: shop.userId,
          token: input.token,
          platform: input.platform,
        })
        .onConflictDoUpdate({
          target: pushTokens.token,
          /*
           * `userId` is in the update set on purpose — it is the whole point
           * of the conflict. `createdAt` is not: the row is the device, and
           * the device is as old as it is.
           */
          set: {
            userId: shop.userId,
            platform: input.platform,
            updatedAt: new Date(),
          },
        });

      return { registered: true };
    }),

  /**
   * Forget this device — sign-out, or the seller turning notifications off.
   *
   * Scoped to the caller's own row rather than deleting by token alone. A
   * token is unguessable and deleting one costs nothing but a re-register, so
   * this is not much of a lock; it is here because "delete where the client
   * says" is a habit worth not having in a router whose entire job is scoping.
   */
  unregister: shopProcedure
    .input(z.object({ token: pushToken }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const shop = found(
        await db.query.shops.findFirst({
          where: eq(shops.id, ctx.shopId),
          columns: { userId: true },
        }),
        "shop",
      );

      await db
        .delete(pushTokens)
        .where(
          and(eq(pushTokens.token, input.token), eq(pushTokens.userId, shop.userId)),
        );

      return { registered: false };
    }),
});
