import "server-only";
import { and, eq, gt, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  eventReminders,
  orderItems,
  orders,
  products,
  shops,
  type Order,
  type Product,
  type Shop,
} from "@sailo/db/schema";
import { downloadUrl } from "../orders/downloads";
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
};

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
    .selectDistinctOn([orders.id, products.id], {
      order: orders,
      product: products,
      shop: shops,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, eq(products.id, orderItems.productId))
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .where(
      and(
        eq(products.kind, "event"),
        isNotNull(products.eventStartsAt),
        gt(products.eventStartsAt, from),
        lte(products.eventStartsAt, to),
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
          startsAt: row.product.eventStartsAt,
          // Released is already in the WHERE above, so the link is earned.
          joinUrl: online ? row.product.eventJoinUrl : null,
          location: online ? null : row.product.serviceLocation,
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
