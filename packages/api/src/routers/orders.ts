import { z } from "zod";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orderItems, orders, shops } from "@sailo/db/schema";
import { ORDER_STATUSES } from "@sailo/core/order-status";
import { changeOrderStatus } from "@sailo/commerce/orders";
import { decodeCursor, olderThan, pageOf } from "@sailo/commerce/pagination";
import { publishShopEvent } from "@sailo/events";
import { router, shopProcedure } from "../trpc";
import { byId, found, listInput } from "../shared";

/**
 * A page of orders, and what a seller may narrow it to.
 *
 * Built on `listInput` so the page-size ceiling is the one `shared.ts` states
 * rather than a second copy of it. The search spans the three things a seller
 * actually has in front of them when they go looking — a name, an email, or the
 * reference the buyer typed on a bank transfer — and every one of them is
 * `and`-ed onto a predicate that already carries `ctx.shopId`.
 */
const pageInput = listInput
  .unwrap()
  .extend({
    /** The previous page's `nextCursor`, opaque. Absent starts at the top. */
    cursor: z.string().max(200).optional(),
    search: z.string().trim().max(120).optional(),
    status: z.enum(ORDER_STATUSES).optional(),
  })
  .optional();

/** What the seller came to the app for: the orders, and moving them along. */
export const ordersRouter = router({
  /**
   * Newest first, keyset-paged.
   *
   * The cursor is the last row of the previous page rather than a count of
   * rows skipped, and on this list in particular that is not a refinement:
   * orders arrive at the *front*, so a seller scrolling while an order comes
   * in would have offset paging hand them page two starting one row late —
   * skipping an order they had never seen, silently. See
   * `@sailo/commerce/pagination`.
   *
   * The rows are order *headers*. `productTitle` and `quantity` on them
   * summarise the first line only, so anything asking what was actually bought
   * reads `items` from `get` rather than inferring it here.
   */
  list: shopProcedure.input(pageInput).query(async ({ ctx, input }) => {
    const limit = input?.limit ?? 50;
    const search = input?.search?.trim();

    const rows = await getDb().query.orders.findMany({
      where: and(
        eq(orders.shopId, ctx.shopId),
        olderThan(orders, decodeCursor(input?.cursor)),
        input?.status ? eq(orders.status, input.status) : undefined,
        search
          ? or(
              ilike(orders.customerName, `%${search}%`),
              ilike(orders.customerEmail, `%${search}%`),
              ilike(orders.paymentReference, `%${search}%`),
            )
          : undefined,
      ),
      // Both halves of the key, or the cursor cannot resume a tie — and an
      // import writing fifty orders in one millisecond is a real tie.
      orderBy: [desc(orders.createdAt), desc(orders.id)],
      limit: limit + 1,
    });

    return pageOf(rows, limit);
  }),
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
   * dropdown offers, and `changeOrderStatus` from `@sailo/commerce` is the
   * same function the web action calls. That is the point of both packages
   * existing — a status set from a phone puts the same units back on the
   * shelf, voids the same tickets and fires the same webhooks as one set from
   * a browser.
   *
   * KNOWN GAP, and it is a real one, though it is now one thing rather than
   * three. apps/web also emails the buyer a booking decision, and this does
   * not — so a seller who *declines or confirms an appointment* from the phone
   * leaves the buyer un-emailed, where the same click on the web would have
   * told them. `sendBookingDecision` lives in a 3,000-line module in apps/web
   * that owns Resend and the HTML layout, and `apps/api` cannot import from
   * that app; `packages/email` is the work order that frees it, and
   * `changeOrderStatus` already returns the `transition` its guard needs.
   *
   * The other two closed. The webhooks moved into `@sailo/commerce` and fire
   * from here; `revalidatePath` is a callback the web action passes and this
   * one does not, because there is no Next request scope here and no page of
   * the seller's that this process caches.
   */
  updateStatus: shopProcedure
    .input(byId.extend({ status: z.enum(ORDER_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      /*
       * The row, not just the id. The webhook's plan gate reads the shop's
       * billing and its envelope carries the handle, and inventing either from
       * `ctx.shopId` would be a payload that differs from the web app's for the
       * same event. `shopProcedure` has already proved the caller owns it.
       */
      const shop = found(
        await getDb().query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
        "shop",
      );

      // No `defer` and no `revalidate`: the emission is awaited, for the same
      // reason the publish below is.
      const change = await changeOrderStatus({
        shop,
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
