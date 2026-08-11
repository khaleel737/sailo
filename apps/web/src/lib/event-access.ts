import "server-only";
import { inArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products, type Order } from "@sailo/db/schema";
import { orderLines } from "@/lib/order-lines";

/**
 * What a registration actually entitles somebody to, and when.
 *
 * The join link to an online event *is* the thing being sold — it is not a
 * detail about the purchase, it is the purchase — so handing it out before
 * the money settles gives the event away to anyone willing to click through
 * checkout and abandon the payment. The gate is `downloadReleasedAt`, the
 * same timestamp that unlocks a digital order's files and validates a ticket,
 * so there is one answer to "has this order been paid for" rather than three.
 *
 * The gate lives *inside* this function rather than at its call sites. Three
 * screens and two emails want this list, and a rule that each of them has to
 * remember is a rule one of them will not — which is how a link leaks. Ask
 * for the events and you get the link only if the order has earned it.
 */

export type EventAccess = {
  productId: string;
  title: string;
  startsAt: Date | null;
  /** Null until the order is released, and null for an in-person event. */
  joinUrl: string | null;
  /** Where to turn up, for an event with a venue. */
  location: string | null;
  online: boolean;
  /** True when the order has not been released — so the buyer can be told. */
  locked: boolean;
};

export async function eventAccessForOrder(order: Order): Promise<EventAccess[]> {
  const lines = await orderLines(order);

  /*
   * Read from the lines, never from `order.productKind`. That column
   * describes the order's *first* line, so a basket holding a mug and a
   * webinar reads as "physical" and the buyer is never given their link —
   * bug shape number four, and this is the fifth place it would have landed.
   */
  const ids = [
    ...new Set(
      lines
        .filter((line) => line.kind === "event")
        .map((line) => line.productId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (ids.length === 0) return [];

  const rows = await getDb().query.products.findMany({
    where: inArray(products.id, ids),
    columns: {
      id: true,
      title: true,
      eventStartsAt: true,
      eventJoinUrl: true,
      serviceMode: true,
      serviceLocation: true,
    },
  });

  const released = order.downloadReleasedAt !== null;

  return rows.map((product) => {
    const online = product.serviceMode === "online";
    return {
      productId: product.id,
      title: product.title,
      startsAt: product.eventStartsAt,
      joinUrl: released && online ? product.eventJoinUrl : null,
      location: online ? null : product.serviceLocation,
      online,
      locked: !released,
    };
  });
}

