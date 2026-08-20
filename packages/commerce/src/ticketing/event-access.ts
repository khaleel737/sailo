import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  eventSessions,
  orderItems,
  products,
  type EventSession,
  type Order,
} from "@sailo/db/schema";
import { orderLines } from "../orders/order-lines";

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
  /**
   * Which date this row is, when the order named one — spec 50.
   *
   * Null for an event that runs once, which is every event without sessions.
   * It is also what makes a row *identifiable*: this list used to hold at most
   * one entry per product and is now one per date, so `productId` alone is no
   * longer unique and anything keying on it — a React list, a calendar UID —
   * would collapse two dates into one.
   */
  sessionId: string | null;
  title: string;
  startsAt: Date | null;
  /** When it is over, when the seller said. Null when they did not. */
  endsAt: Date | null;
  /** Null until the order is released, and null for an in-person event. */
  joinUrl: string | null;
  /** Where to turn up, for an event with a venue. */
  location: string | null;
  online: boolean;
  /** True when the order has not been released — so the buyer can be told. */
  locked: boolean;
  /**
   * The zone the seller means, for a calendar entry's `TZID` — spec 50.
   *
   * Carried on the row rather than looked up by the caller, because the caller
   * has the *order* and an order may hold two events: reading
   * `order.productId`'s zone would label a webinar with the zone of the mug
   * that happened to be the order's first line. Null falls back to the shop's.
   */
  timeZone: string | null;
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
      eventEndsAt: true,
      eventJoinUrl: true,
      eventTimeZone: true,
      serviceMode: true,
      serviceLocation: true,
    },
  });

  const released = order.downloadReleasedAt !== null;

  /*
   * The date this buyer actually bought, on an event that runs several — spec
   * 50.
   *
   * `products.event_starts_at` is the *first* date of a series, so a buyer who
   * picked the fourth Tuesday of a weekly class was shown the first Tuesday
   * here — in their confirmation, on their delivery page and in the calendar
   * entry built from it — and would have turned up three weeks early. That is
   * not a display bug anybody reports; it is somebody standing outside a
   * locked door.
   *
   * One row per date rather than one per product, because a buyer who bought
   * two dates of one class bought two things to turn up to. A line naming no
   * session falls back to the product's own date, which is every event today.
   *
   * Two extra reads, and the second is skipped unless this order names a date.
   */
  const named = await getDb()
    .select({ sessionId: orderItems.sessionId })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, order.id), isNotNull(orderItems.sessionId)));

  const sessionIds = [
    ...new Set(
      named.map((row) => row.sessionId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const sessionRows = sessionIds.length
    ? await getDb().query.eventSessions.findMany({
        where: inArray(eventSessions.id, sessionIds),
        orderBy: [asc(eventSessions.startsAt)],
      })
    : [];

  const datesByProduct = new Map<string, EventSession[]>();
  for (const session of sessionRows) {
    const list = datesByProduct.get(session.productId) ?? [];
    list.push(session);
    datesByProduct.set(session.productId, list);
  }

  // Annotated, because the two branches below infer as a union of two array
  // types rather than one array of the union — `sessionId: string` from the
  // dated branch and `sessionId: null` from the fallback.
  return rows.flatMap((product): EventAccess[] => {
    const online = product.serviceMode === "online";
    const base = {
      productId: product.id,
      title: product.title,
      online,
      locked: !released,
      // This event's own zone, not the order header product's.
      timeZone: product.eventTimeZone,
    };

    const dates = datesByProduct.get(product.id);
    if (dates?.length) {
      return dates.map((session) => ({
        ...base,
        sessionId: session.id,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        /*
         * The date's own link and room when it has them, the product's
         * otherwise. A conference that moves one day online, or a class that
         * changes rooms for a week, says so on the row for that day rather
         * than on all of them — and the gate is unchanged: a link is handed
         * over only once the order is released.
         */
        joinUrl: released && online ? (session.joinUrl ?? product.eventJoinUrl) : null,
        location: online ? null : (session.location ?? product.serviceLocation),
      }));
    }

    return [
      {
        ...base,
        sessionId: null,
        startsAt: product.eventStartsAt,
        endsAt: product.eventEndsAt,
        joinUrl: released && online ? product.eventJoinUrl : null,
        location: online ? null : product.serviceLocation,
      },
    ];
  });
}

