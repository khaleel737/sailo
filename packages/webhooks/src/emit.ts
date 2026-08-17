import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  orderItems,
  orders,
  webhookDeliveries,
  webhookEndpoints,
  type Shop,
} from "@sailo/db/schema";
import { can } from "@sailo/core/plans";
import {
  contactPayload,
  envelope,
  orderPayload,
  type WebhookEvent,
} from "./events";

/**
 * Turning something that happened into rows in the delivery queue.
 *
 * Here rather than in `apps/web` because a seller with a phone in their hand
 * fires the same events as one with a browser open. This was the web app's, and
 * the consequence was `orders.updateStatus` in `@sailo/api` cancelling an order
 * without telling anybody's Zap — a silence the router documented and nobody
 * could see from the app.
 *
 * It spent a release in `@sailo/commerce`, because an order is what it reads.
 * That put the two halves of one subject in two packages that then imported
 * each other — `commerce` needed the catalogue, `webhooks` re-exported the
 * emitter — and turbo refused the graph. The catalogue is `./events`, which a
 * browser may import; this half writes to the database and may not. Both belong
 * to whoever sends the webhook.
 *
 * Two rules govern every call site, and both are about *when*:
 *
 * **After the business write, never before it.** An emitted event for an order
 * that then failed to commit is a lie told to somebody's CRM, and it is not
 * retractable — the Zap has already run, the customer has already been mailed.
 * Every call site inside Next wraps this in `after()`, which runs once the
 * response has gone; `webhooks/emit.test.ts` in apps/web asserts that they kept
 * doing so. Off-server there is no `after()` and the call is awaited instead —
 * still after the write, which is the part that matters.
 *
 * **Off the critical path.** This reads the order back and writes a row per
 * endpoint. Nobody waits for it: a buyer pressing Pay must not sit on a
 * spinner while we prepare somebody's Zapier payload.
 *
 * Nothing here throws. A shop with no endpoints, a plan that does not include
 * the feature, a database hiccup — all of them mean "no webhook", which is
 * exactly what happened before this feature existed.
 */

/**
 * The endpoints of one shop that asked for this event.
 *
 * Filtered in SQL rather than in TypeScript, because the alternative reads
 * every endpoint row on every order. `&&` is array overlap, which the
 * `events` column can answer directly.
 */
async function subscribedEndpoints(shopId: string, event: WebhookEvent) {
  return getDb()
    .select({
      id: webhookEndpoints.id,
      url: webhookEndpoints.url,
    })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.shopId, shopId),
        eq(webhookEndpoints.isActive, true),
        sql`${webhookEndpoints.events} && ARRAY[${event}]::text[]`,
      ),
    );
}

/**
 * Queues one event for every endpoint of this shop that wants it.
 *
 * The delivery id is minted here rather than left to the column default,
 * because it has to be *inside* the payload as well as on the row: the
 * `webhook-id` header and the envelope's `id` are the same string, and a
 * consumer is told to dedupe on it. Reading it back after the insert would
 * mean building the body twice.
 */
export async function emitWebhook(opts: {
  shop: Shop;
  event: WebhookEvent;
  data: Record<string, unknown>;
  now?: Date;
}): Promise<void> {
  try {
    const { shop, event, data } = opts;

    /*
     * The plan gate lives here, at the single point every event passes
     * through, rather than at seven call sites that would each have to
     * remember it. A seller who downgrades stops emitting immediately —
     * their endpoints stay configured and inert, which is what they will
     * expect when they upgrade again.
     */
    if (!can(shop, "integrations")) return;

    const endpoints = await subscribedEndpoints(shop.id, event);
    if (endpoints.length === 0) return;

    const now = opts.now ?? new Date();

    await getDb()
      .insert(webhookDeliveries)
      .values(
        endpoints.map((endpoint) => {
          const id = randomUUID();
          return {
            id,
            endpointId: endpoint.id,
            shopId: shop.id,
            event,
            payload: envelope({ id, event, shop, data, now }),
            status: "pending",
            nextAttemptAt: now,
          };
        }),
      );
  } catch (error) {
    // Logged, never raised. The caller is an order that has already been
    // placed, and no webhook is worth failing one.
    console.error("[sailo] webhook emit failed", error);
  }
}

/**
 * The same, for the six events whose subject is an order.
 *
 * Takes an id and reads the row rather than taking the caller's draft, for the
 * reason `notifySellerOfOrder` gives: the row is what actually exists, and a
 * caller's in-memory copy is a snapshot from before the writes that followed
 * it. On the card rail in particular, the object `createOrderIntent` built
 * says `pending` for a payment the webhook has since settled.
 *
 * Reads nothing at all when no endpoint wants the event — the common case by
 * far, since most shops have no endpoints — so the ordinary order pays for one
 * cheap indexed query and no more.
 */
export async function emitOrderWebhook(opts: {
  shop: Shop;
  event: WebhookEvent;
  orderId: string;
  now?: Date;
}): Promise<void> {
  try {
    const { shop, event, orderId } = opts;

    if (!can(shop, "integrations")) return;
    if ((await subscribedEndpoints(shop.id, event)).length === 0) return;

    const db = getDb();
    /*
     * Ownership in the WHERE, not assumed from the caller.
     *
     * Every current call site already holds the shop and the order together,
     * so this can only ever be belt-and-braces — but it is the cheap kind, and
     * the failure it prevents is one shop's order being described to another
     * shop's endpoint, which is the worst thing this feature could do.
     */
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, orderId), eq(orders.shopId, shop.id)),
    });
    if (!order) return;

    const items = await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, orderId),
      orderBy: [asc(orderItems.position)],
    });

    await emitWebhook({
      shop,
      event,
      data: orderPayload(order, items),
      now: opts.now,
    });
  } catch (error) {
    console.error("[sailo] order webhook emit failed", error);
  }
}

/** `contact.created`, from a client row that has just been written. */
export async function emitContactWebhook(opts: {
  shop: Shop;
  clientId: string;
  now?: Date;
}): Promise<void> {
  try {
    const { shop, clientId } = opts;

    if (!can(shop, "integrations")) return;
    if ((await subscribedEndpoints(shop.id, "contact.created")).length === 0) return;

    const client = await getDb().query.clients.findFirst({
      where: and(eq(clients.id, clientId), eq(clients.shopId, shop.id)),
    });
    if (!client) return;

    await emitWebhook({
      shop,
      event: "contact.created",
      data: contactPayload(client),
      now: opts.now,
    });
  } catch (error) {
    console.error("[sailo] contact webhook emit failed", error);
  }
}
