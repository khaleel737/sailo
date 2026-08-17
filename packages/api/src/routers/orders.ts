import { z } from "zod";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orderItems, orders, shops } from "@sailo/db/schema";
import { ORDER_STATUSES } from "@sailo/core/order-status";
import { TRPCError } from "@trpc/server";
import { changeOrderStatus } from "@sailo/commerce/orders/server";
import { refundOrder } from "@sailo/commerce/orders/server";
import { shipOrder } from "@sailo/commerce/orders/server";
import { setPaymentStatus } from "@sailo/commerce/orders/server";
import {
  sendBookingDecision,
  sendDownloadReady,
  sendRefundNotification,
  sendShippingNotification,
} from "@sailo/email/transactional";
import { olderThan, pageOf } from "@sailo/commerce/pagination";
import { publishShopEvent } from "@sailo/events";
import { router, shopProcedure } from "../trpc";
import { byId, found, listInput, cursorFrom } from "../shared";

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
        olderThan(orders, cursorFrom(input?.cursor)),
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
      /*
       * `found` narrows `undefined`, and this is `null` — so it throws
       * correctly and does not narrow. The explicit check is what makes the
       * transition below readable rather than a chain of `!`.
       */
      found(change, "order");
      if (!change) throw new TRPCError({ code: "NOT_FOUND", message: "No such order." });

      /*
       * The gap this procedure's own header has documented since it was
       * written, now closed.
       *
       * Checkout promises that the shop confirms an appointment afterwards, so
       * moving a booked order off `new` *is* the seller answering — and until
       * `@sailo/email` existed, answering from the phone left the buyer with
       * the promise and no reply. `sendBookingDecision` is the same message
       * the web admin sends, from the same module.
       *
       * Awaited, like the publish below and for the same reason: there is no
       * `after` outside a Next request scope, and a swallowed send would leave
       * a seller believing they had told somebody their booking was confirmed.
       */
      if (change.transition.answeredBooking) {
        /*
         * `previous` is the row as it read *before* the write, and that is the
         * right one to send: the message prints the appointment and what was
         * ordered, neither of which a status change touches. The one field
         * that did change is the status, which the email never names —
         * `accepted` carries that, decided from the transition rather than
         * re-read from a row.
         */
        await sendBookingDecision({
          shop,
          order: change.previous,
          accepted: change.transition.bookingAccepted,
        });
      }

      /*
       * Every other screen looking at this shop: the seller's own browser,
       * the staff panel. Awaited rather than deferred — there is no `after`
       * outside Next's request scope, and swallowing the publish would mean
       * a web dashboard sitting on a status the phone has already changed.
       */
      await publishShopEvent(ctx.shopId, "order");
      return { id: input.id, status: input.status };
    }),

  /**
   * Giving money back.
   *
   * **The thing this app could not do**, and the reason it could not was never
   * the money: `refundCharge` has been reachable since the Stripe seam moved
   * into `@sailo/payments`. It was the buyer's email, which lived inside
   * apps/web — and a refund that moves money while telling nobody is worse
   * than a refund button that does not exist. `@sailo/email/orders` is what
   * closed that, and `notify` below is the whole of the difference.
   *
   * Every rule about *how* a refund happens is `refundOrder`'s: claim the
   * balance in SQL before calling the processor, reverse before recording,
   * release the claim if the processor refuses, and decide fullness from the
   * claim rather than from the row read before it. Five orderings, each one
   * guarding a way to lose money that no screen would show.
   *
   * `defer` is deliberately not passed. apps/web hands Next's `after` so the
   * seller is not made to wait on an email; there is no scheduler outside a
   * Next request scope, so this awaits the send — which is the correct trade
   * on a phone, where the seller is looking at the screen and a silent
   * failure would be invisible.
   */
  refund: shopProcedure
    .input(
      byId.extend({
        /** Minor units. Omitted refunds whatever is left, never the whole
            order a second time. */
        amountCents: z.number().int().positive().nullish(),
        reason: z.string().max(300).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const shop = found(
        await getDb().query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
        "shop",
      );

      const result = await refundOrder(
        {
          shop,
          orderId: input.id,
          amountCents: input.amountCents ?? null,
          reason: input.reason ?? null,
        },
        {
          notify: async ({ shop: s, order }) => {
            await sendRefundNotification({ shop: s, order });
          },
        },
      );

      if (!result.ok) {
        if (result.reason === "not_found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "No such order." });
        }
        if (result.reason === "reversal_failed") {
          /*
           * The processor refused and nothing was written — the claim was
           * released, so the seller can try again. `BAD_GATEWAY` rather than
           * `BAD_REQUEST` because nothing about their input was wrong.
           */
          throw new TRPCError({ code: "BAD_GATEWAY", message: "reversal_failed" });
        }
        if (result.reason === "raced") {
          throw new TRPCError({ code: "CONFLICT", message: "raced" });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
      }

      /* Every other screen looking at this shop, and the money path in
         particular — a refund changes the dashboard's net revenue. */
      await publishShopEvent(ctx.shopId, "payment");

      return {
        id: input.id,
        amountCents: result.amountCents,
        refundedTotal: result.refundedTotal,
        isFull: result.isFull,
        /* Whether a processor actually moved money. A bank transfer or a cash
           sale settles between two people, so the seller is told to pay them
           back themselves rather than being left to assume Stripe did. */
        reversed: result.outcome.kind === "reversed",
      };
    }),

  /**
   * Recording dispatch, and telling the buyer.
   *
   * The other half of what `packages/email` unblocked. Nothing here can
   * half-fail the way a refund can — there is no processor and no balance —
   * so `shipOrder` is a much smaller function, and what it owns is the
   * tracking URL: a carrier's link is pasted by hand, half of them arrive
   * without a scheme, and the only place one is ever used is a button in the
   * buyer's email.
   *
   * `notified` comes back rather than being swallowed. An order taken over the
   * counter has no email address, which is a fact about the order — but a
   * *send* that failed is a fact about the system, and a seller who believes
   * their buyer has tracking when they do not will not chase it.
   */
  markShipped: shopProcedure
    .input(
      byId.extend({
        carrier: z.string().max(80).nullish(),
        trackingNumber: z.string().max(120).nullish(),
        trackingUrl: z.string().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const shop = found(
        await getDb().query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
        "shop",
      );

      const result = await shipOrder(
        {
          shop,
          orderId: input.id,
          carrier: input.carrier ?? null,
          trackingNumber: input.trackingNumber ?? null,
          trackingUrl: input.trackingUrl ?? null,
        },
        {
          /* Awaited, not deferred — there is no scheduler outside a Next
             request scope, and the seller is looking at the screen. */
          notify: (args) => sendShippingNotification(args),
        },
      );

      if (!result.ok) {
        if (result.reason === "not_found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "No such order." });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
      }

      await publishShopEvent(ctx.shopId, "order");
      return { id: input.id, notified: result.notified };
    }),

  /**
   * Confirming that money arrived.
   *
   * The most phone-shaped write in the product and the last one to arrive.
   * There is no card and no webhook on a bank transfer or a handful of cash at
   * a market stall — this *is* the event that means paid, and the seller
   * standing in front of the buyer who just handed them notes is exactly who
   * needs to make it.
   *
   * It waited this long because of what it sets off rather than what it
   * writes. Marking an order paid unlocks a held-back download and starts or
   * extends a manual membership, and both of those lived in apps/web — so a
   * phone that only flipped the column would have left a buyer who had paid
   * unable to get the file they bought. `setPaymentStatus` does all three or
   * none.
   *
   * Which statuses a seller may set is `@sailo/core/payment-status`'s and
   * not this file's. `disputed` is the one withheld: a chargeback is a fact a
   * bank reported, not an opinion the seller holds, and clearing it from a
   * control would hide money that has already left their balance.
   */
  setPaymentStatus: shopProcedure
    .input(byId.extend({ paymentStatus: z.string().max(40) }))
    .mutation(async ({ ctx, input }) => {
      const shop = found(
        await getDb().query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
        "shop",
      );

      const result = await setPaymentStatus(
        { shop, orderId: input.id, paymentStatus: input.paymentStatus },
        {
          /* The sender comes from the caller, not from inside the domain —
             composing it needs an order's lines, and importing it there made
             the two packages depend on each other. */
          notifyDownloads: (args) => sendDownloadReady(args),
        },
      );

      if (!result.ok) {
        if (result.reason === "not_found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "No such order." });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
      }

      /* `payment` rather than `order`: this changes the dashboard's takings,
         and the staff panel watches that stream separately. */
      await publishShopEvent(ctx.shopId, "payment");

      return {
        id: input.id,
        paymentStatus: input.paymentStatus,
        /* So the screen can say "and their download is now available" rather
           than leaving the seller to wonder whether it was. */
        releasedDownloads: result.releasedDownloads,
      };
    }),
});
