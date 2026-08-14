import { z } from "zod";
import {
  DOOR_FILTERS,
  eventDoorList,
  eventDoorStats,
  shopEvents,
} from "@sailo/commerce/door-list";
import { router, shopProcedure } from "../trpc";

/**
 * Bookable events: the classes and sessions a seller puts on a calendar, as
 * distinct from `orders`, which is what someone bought.
 *
 * Not to be confused with `@sailo/events`, the shop-event publisher the orders
 * router uses to wake other screens. Same word, different thing — this one is a
 * product the seller sells.
 *
 * Both procedures answer with the shapes `@sailo/commerce/door-list` defines,
 * unchanged. That is not laziness: the counters over a door and the guest list
 * a volunteer searches are rendered on a laptop in the back room *and* on the
 * phone at the entrance, at the same time, about the same queue. Two shapes
 * would be two implementations, and two implementations of "who is still
 * outside" is how the two screens come to disagree while both look right.
 */
export const eventsRouter = router({
  /**
   * The seller's events, soonest first, with tonight's at the top.
   *
   * Past events stay listed rather than disappearing at their start time — a
   * door is still being worked an hour after the advertised start, which is
   * when the stragglers arrive, and an organiser reconciling attendance the
   * next morning needs the list to still be there. `pastDays` says how far
   * back, and is stated rather than hidden: the screen showing this list can
   * say "the last 30 days" because it chose the number.
   */
  list: shopProcedure
    .input(z.object({ pastDays: z.number().int().min(0).max(365).default(30) }).optional())
    .query(({ ctx, input }) =>
      shopEvents(ctx.shopId, { pastDays: input?.pastDays ?? 30 }),
    ),

  /**
   * Everything one door screen needs, in one round trip: the counters above
   * the door and the page of names below them.
   *
   * Together rather than as two procedures because they are read together on
   * every single admission — three volunteers scanning is three clients
   * polling, and splitting it doubles that for no gain.
   *
   * The list is capped and the cap is not silent: `total` is every row
   * matching the filter, so a screen showing 100 of 340 can say so. It is
   * offset-paged rather than keyset-paged, deliberately and unlike the order
   * and product lists — this one is sorted alphabetically by the attendee's
   * name, which does not change while a volunteer scrolls it, so the reason
   * keyset paging exists over `createdAt desc` does not apply here.
   */
  door: shopProcedure
    .input(
      z.object({
        productId: z.uuid(),
        search: z.string().trim().max(120).optional(),
        status: z.enum(DOOR_FILTERS).default("all"),
        tier: z.string().max(80).nullish(),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [stats, list] = await Promise.all([
        eventDoorStats(ctx.shopId, input.productId),
        eventDoorList(
          ctx.shopId,
          input.productId,
          {
            search: input.search ?? "",
            status: input.status,
            tier: input.tier ?? null,
          },
          input.limit,
          input.offset,
        ),
      ]);

      return { stats, rows: list.rows, total: list.total, limit: input.limit };
    }),
});
