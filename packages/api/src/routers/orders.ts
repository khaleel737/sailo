import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orderItems, orders } from "@sailo/db/schema";
import { ORDER_STATUSES } from "@sailo/core/order-status";
import { applyOrderStatus } from "@sailo/commerce/orders";
import { publishShopEvent } from "@sailo/events";
import { router, shopProcedure } from "../trpc";
import { byId, found, listInput } from "../shared";

/** What the seller came to the app for: the orders, and moving them along. */
export const ordersRouter = router({
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
});
