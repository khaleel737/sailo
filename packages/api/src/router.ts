import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  orderItems,
  orders,
  productImages,
  productVariants,
  products,
  pushTokens,
  shops,
} from "@sailo/db/schema";
import { ORDER_STATUSES } from "@sailo/core/order-status";
import { applyOrderStatus } from "@sailo/commerce/orders";
import { publishShopEvent } from "@sailo/events";
import { router, shopProcedure } from "./trpc";

const listInput = z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional();

/**
 * The id of a row the caller claims is theirs — checked against `ctx.shopId`
 * in the WHERE, never taken as proof of anything on its own.
 *
 * `uuid()` rather than a bare string because both columns are `uuid`: handing
 * Postgres `"' or 1=1"` for one of these is not a leak — drizzle parameterises
 * it — but it *is* an `invalid input syntax for type uuid`, which reaches the
 * seller as a 500 from a screen that should have said "not found".
 */
const byId = z.object({ id: z.uuid() });

/**
 * An Expo push token, in either spelling Expo's own SDK accepts.
 *
 * Checked on the way in rather than at send time because this column exists to
 * be POSTed to a third party: anything that gets stored here will one day be
 * put in a request body to Expo, and the cheapest place to refuse a junk value
 * is before it becomes a row. Deliberately loose about the contents of the
 * brackets — the shape is documented, the payload inside is Expo's business.
 */
const pushToken = z
  .string()
  .regex(/^Expo(nent)?PushToken\[[^\]\s]+\]$/, "Not an Expo push token.");

/**
 * One answer for "that row isn't yours" and "that row doesn't exist".
 *
 * Both are `NOT_FOUND` on purpose. The scoping is done by the WHERE, so a row
 * belonging to another shop simply doesn't match and arrives here as
 * `undefined` — and if the two cases answered differently, a seller could
 * learn which ids exist in someone else's shop by reading the error code.
 */
function found<T>(row: T | undefined, what: string): T {
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `No such ${what}.` });
  return row;
}

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
  }),
  orders: router({
    list: shopProcedure.input(listInput).query(({ ctx, input }) =>
      getDb().query.orders.findMany({
        where: eq(orders.shopId, ctx.shopId),
        orderBy: desc(orders.createdAt),
        limit: input?.limit ?? 50,
      }),
    ),
    /**
     * One order and its lines. `orderItems` is the authoritative list — the
     * header's `productTitle`/`quantity` columns are a summary of the first
     * line — so a screen that shows what was actually bought reads `items`.
     */
    get: shopProcedure.input(byId).query(async ({ ctx, input }) =>
      found(
        await getDb().query.orders.findFirst({
          where: and(eq(orders.id, input.id), eq(orders.shopId, ctx.shopId)),
          with: { items: { orderBy: asc(orderItems.position) } },
        }),
        "order",
      ),
    ),

    /**
     * The seller moving an order along — the app's first write.
     *
     * The status list and the cascade behind it are both imported, not
     * restated: `ORDER_STATUSES` from `@sailo/core` is the same list the web
     * dropdown offers, and `applyOrderStatus` from `@sailo/commerce` is the
     * same function the web action calls. That is the point of both packages
     * existing — a status set from a phone puts the same units back on the
     * shelf and voids the same tickets as one set from a browser.
     *
     * KNOWN GAP, and it is a real one. apps/web does three further things this
     * does not: it emails the buyer a booking decision, emits the
     * `order.cancelled` / `booking.confirmed` webhooks, and revalidates the
     * storefront cache. All three need a `Shop` row and Next's request scope,
     * and neither was lifted. So a seller who confirms an *appointment* from
     * the phone leaves the buyer un-emailed, where the same click on the web
     * would have told them. Until those move too, the app is safe for ordinary
     * orders and lossy for booked ones.
     */
    updateStatus: shopProcedure
      .input(byId.extend({ status: z.enum(ORDER_STATUSES) }))
      .mutation(async ({ ctx, input }) => {
        const change = await applyOrderStatus({
          shopId: ctx.shopId,
          orderId: input.id,
          status: input.status,
        });
        // Null means no order in *this* shop has that id — the same answer,
        // for the same reason, as the reads above.
        found(change, "order");

        /*
         * Every other screen looking at this shop: the seller's own browser,
         * the staff panel. Awaited rather than deferred — there is no `after`
         * outside Next's request scope, and swallowing the publish would mean
         * a web dashboard sitting on a status the phone has already changed.
         */
        await publishShopEvent(ctx.shopId, "order");
        return { id: input.id, status: input.status };
      }),
  }),

  /**
   * Where to reach this seller's phone.
   *
   * `shopProcedure` like everything else here, even though the row it writes is
   * keyed on the *user*. That is not a loophole in the shop-scoping rule, it is
   * the rule applied one step further: the client sends a device token and
   * nothing else, and the account it gets filed under is read from the shop the
   * session already resolved to. There is no input a caller could put a
   * different person's id into, which is the property that matters — the same
   * one the `eq(..., ctx.shopId)` predicates hold for every read above.
   */
  push: router({
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
  }),
});

export type AppRouter = typeof appRouter;
