import "server-only";
import { and, eq, gt, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  eventReminders,
  eventSessions,
  orderItems,
  orders,
  products,
  shops,
  type EventSession,
  type Order,
  type Product,
  type Shop,
} from "@sailo/db/schema";
import { downloadUrl } from "@sailo/commerce/orders/server";
import { sendEventReminder } from "@sailo/email/transactional";

/**
 * Telling registrants their event is about to start.
 *
 * Two passes, a day out and an hour out, and the whole design question is
 * "how does this send exactly once". Not by remembering when it last ran — a
 * cron that runs twice, or a deploy that replays it, or two regions firing
 * together would each send again. The claim is a row: `event_reminders` has a
 * unique index on (order, product, lead), so the INSERT itself is the
 * permission to send and Postgres arbitrates. Nothing here reads to decide
 * whether to write.
 *
 * That also makes the *query* window unimportant. It can be as generous as it
 * likes — "every event in the next day that has not had its day-out
 * reminder" — because a second pass over the same rows claims nothing and
 * sends nothing.
 */

export const REMINDER_LEADS = ["24h", "1h"] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number];

/**
 * The window each pass covers, in minutes from now.
 *
 * Non-overlapping, and that is the point. If the day-out pass covered
 * everything up to 24 hours away it would also cover everything up to one
 * hour away, so somebody registering forty minutes before the doors open
 * would get both emails at once, which reads as a bug to the person holding
 * the phone. The day-out pass therefore stops where the hour-out pass begins.
 */
const WINDOWS: Record<ReminderLead, { fromMinutes: number; toMinutes: number }> = {
  "24h": { fromMinutes: 60, toMinutes: 24 * 60 },
  "1h": { fromMinutes: 0, toMinutes: 60 },
};

/** Orders whose registration no longer stands. */
const RELEASED_STATUSES = ["cancelled", "refunded"] as const;

/** A ceiling, so one pass cannot become an unbounded mail run. */
const MAX_PER_PASS = 500;

type DueRow = {
  order: Order;
  product: Product;
  shop: Shop;
  /**
   * Which date this registration is for — spec 50. Null for an event that runs
   * once, which is every event this cron has ever reminded anybody about.
   */
  session: EventSession | null;
};

/**
 * When this registration actually starts.
 *
 * `products.event_starts_at` on a multi-date event is the **first** date and
 * nothing else, so keying the window on it reminded a buyer holding the fourth
 * Tuesday of a weekly class twenty-four hours before the *first* Tuesday — and
 * then never again, because the claim row was spent by that send. Three weeks
 * early, and silent on the night. The session's own start is the answer
 * wherever a line names one.
 *
 * An `all_access` pass names no session and keeps the product's date, which is
 * right: a conference pass is reminded before the conference, once, rather than
 * once for each of its eight days.
 */
const startsAtExpr = sql<Date>`coalesce(${eventSessions.startsAt}, ${products.eventStartsAt})`;

/**
 * A bound against that expression, encoded the way the column would be.
 *
 * **`sql.param` and not a bare `Date`, and this cost three passing tests to
 * find.** Drizzle encodes a value against the column it is compared to, and a
 * hand-written `coalesce(…)` is not a column — so `gt(startsAtExpr, from)` sent
 * the plain ISO string, which matched no row at all. The cron went quiet and
 * every unit test stayed green, because they mock the comparators. The scenario
 * suite is what caught it.
 *
 * Naming `products.eventStartsAt` as the encoder is what restores the mapping;
 * both sides of the coalesce are the same column type, so either would do.
 */
const startBound = (at: Date) => sql.param(at, products.eventStartsAt);

/**
 * Registrations due a reminder at this lead.
 *
 * Read from `order_items`, never from `orders.productKind` — that column
 * describes the order's first line, so a basket holding a mug and a webinar
 * reads as "physical" and its registrant is never reminded.
 *
 * Only released orders. An unpaid registration is not a registration, and
 * mailing its holder a join link an hour before the event would hand over the
 * event to somebody who abandoned the payment.
 */
async function dueFor(lead: ReminderLead, now: Date): Promise<DueRow[]> {
  const db = getDb();
  const window = WINDOWS[lead];
  const from = new Date(now.getTime() + window.fromMinutes * 60_000);
  const to = new Date(now.getTime() + window.toMinutes * 60_000);

  const rows = await db
    /*
     * The date joins the key — spec 50.
     *
     * A buyer who booked Tuesday *and* Thursday of the same class holds two
     * registrations that start on different days, and each needs its own
     * reminder. Distinct on the product alone collapsed them into one.
     */
    .selectDistinctOn([orders.id, products.id, orderItems.sessionId], {
      order: orders,
      product: products,
      shop: shops,
      session: eventSessions,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, eq(products.id, orderItems.productId))
    .innerJoin(shops, eq(shops.id, orders.shopId))
    // Left, because almost every event has no sessions at all, and those lines
    // must still be reminded off the product's own date.
    .leftJoin(eventSessions, eq(eventSessions.id, orderItems.sessionId))
    .where(
      and(
        eq(products.kind, "event"),
        isNotNull(startsAtExpr),
        gt(startsAtExpr, startBound(from)),
        lte(startsAtExpr, startBound(to)),
        /*
         * A date the seller called off reminds nobody to come to it.
         *
         * Its ticket-holders hear about the cancellation instead, through
         * `claimSessionCancelNotice` — and "your event starts in an hour" sent
         * to somebody whose class was cancelled is the worst mail this system
         * is capable of producing.
         */
        sql`(${eventSessions.id} is null or ${eventSessions.isCancelled} = false)`,
        // The money gate. One timestamp decides this everywhere.
        isNotNull(orders.downloadReleasedAt),
        isNotNull(orders.customerEmail),
        notInArray(orders.status, [...RELEASED_STATUSES]),
        sql`${shops.deletedAt} is null`,
        /*
         * Skipping what has already been claimed keeps the pass small. It is
         * an optimisation and not the guarantee — the guarantee is the unique
         * index, because between this read and the insert below another pass
         * can claim the same row.
         */
        sql`not exists (
          select 1 from ${eventReminders}
          where ${eventReminders.orderId} = ${orders.id}
            and ${eventReminders.productId} = ${products.id}
            and ${eventReminders.sessionId} is not distinct from ${orderItems.sessionId}
            and ${eventReminders.lead} = ${lead}
        )`,
      ),
    )
    .limit(MAX_PER_PASS + 1);

  return rows;
}

/**
 * Sends every reminder now due, at both leads.
 *
 * Returns what it did rather than logging and forgetting, so the cron route
 * can answer with it and a staging run can be read.
 */
export async function sendDueEventReminders(now = new Date()) {
  const db = getDb();
  let sent = 0;
  let failed = 0;
  let clamped = false;

  for (const lead of REMINDER_LEADS) {
    const due = await dueFor(lead, now);
    if (due.length > MAX_PER_PASS) {
      clamped = true;
      console.warn(
        `[sailo] event reminders stopped at ${MAX_PER_PASS} for the ${lead} pass; more were due`,
      );
    }

    for (const row of due.slice(0, MAX_PER_PASS)) {
      /*
       * The claim. An empty result means another pass got there first, which
       * is the ordinary outcome this index exists to produce and not an
       * error — so it moves on rather than sending a second copy.
       */
      const [claimed] = await db
        .insert(eventReminders)
        .values({
          orderId: row.order.id,
          productId: row.product.id,
          /*
           * Part of the claim, not a note on it — spec 50. `0045` gives the
           * unique index `NULLS NOT DISTINCT`, which is what makes a null
           * session collide with itself: without that modifier a single-date
           * event would claim nothing and be reminded once per cron tick for
           * ever.
           */
          sessionId: row.session?.id ?? null,
          lead,
        })
        .onConflictDoNothing()
        .returning({ id: eventReminders.id });
      if (!claimed) continue;

      const online = row.product.serviceMode === "online";
      const result = await sendEventReminder({
        shop: row.shop,
        order: row.order,
        lead,
        event: {
          title: row.product.title,
          /*
           * The date, the room and the link this registration is actually for.
           *
           * The session's own where it has them, the product's otherwise — the
           * same fallback `eventAccessForOrder` applies, and for the same
           * reason: a class that changes rooms for one week has to say so on
           * that week's mail rather than on all of them.
           */
          startsAt: row.session?.startsAt ?? row.product.eventStartsAt,
          // Released is already in the WHERE above, so the link is earned.
          joinUrl: online
            ? (row.session?.joinUrl ?? row.product.eventJoinUrl)
            : null,
          location: online
            ? null
            : (row.session?.location ?? row.product.serviceLocation),
          online,
        },
        portalUrl: row.order.downloadToken
          ? downloadUrl(row.order.downloadToken)
          : null,
      });

      if (result.sent) {
        sent += 1;
        continue;
      }

      failed += 1;
      /*
       * The claim is not rolled back.
       *
       * A failed send with the row deleted would be retried on the next pass,
       * and "retried" is indistinguishable from "sent twice" when the failure
       * was in Resend's response rather than in the delivery. Given a choice
       * between a registrant who was not reminded and one reminded twice an
       * hour before their event, the first is the smaller harm — and it is
       * logged, so it is not a silent one.
       */
      console.warn(
        `[sailo] event reminder (${lead}) not sent for order ${row.order.id}: ${result.reason}`,
      );
    }
  }

  return { sent, failed, clamped };
}
