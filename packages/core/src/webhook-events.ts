import { contactResource, orderResource } from "./resources";
import type { Client, Order, OrderItem, Shop } from "@sailo/db/schema";

/**
 * What Sailo will tell an outside tool about, and exactly what it says.
 *
 * No `server-only` here, on purpose and for the same reason `segments.ts` has
 * none: the settings card renders this catalogue as checkboxes, so the
 * vocabulary has to be importable in the browser. Everything that touches the
 * database, the network or a secret lives in `@sailo/commerce/webhooks`, which
 * is server-only.
 *
 * That split is also why this sits in `@sailo/core` and not in
 * `@sailo/commerce`: the emit machinery is a database write and belongs in a
 * server-only package, but this half ships to a browser in the integrations
 * settings card and to `apps/api`, which is a third bundle again. A package
 * whose every module imports `server-only` can be the home of one of those and
 * not the other. `apps/web/src/lib/webhooks/events.ts` re-exports this file, so
 * the cards and docs pages that import it are untouched.
 *
 * **The objects are not described here.** `./resources` owns what an order or a
 * contact looks like to the outside world, and the REST API returns the very
 * same shapes — so a consumer that receives `order.paid` and then fetches the
 * order sees identical field names. This file owns only the catalogue and the
 * envelope around it.
 *
 * **The payload is a statement about a moment.** It is built once, when the
 * event happens, and stored on the delivery row — never rebuilt at send time.
 * A retry twelve hours later must describe the order as it was, not as it
 * reads now; an `order.created` rebuilt after a refund would arrive claiming a
 * refunded order had just been placed.
 */

/* -------------------------------------------------------------------------- */
/*  The catalogue                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every event, in the order the settings card lists them.
 *
 * Seven, and each one has a real emit point wired to it. A catalogue longer
 * than its emit points is how a seller comes to tick a box, wait for an event
 * that will never arrive, and conclude the feature is broken — so nothing is
 * listed here speculatively.
 *
 * Named `noun.verb`, past tense, and grouped by noun so a consumer filtering
 * on the `order.` prefix gets every order event including ones added later.
 */
export const WEBHOOK_EVENTS = [
  "order.created",
  "order.paid",
  "order.shipped",
  "order.cancelled",
  "order.refunded",
  "booking.confirmed",
  "contact.created",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * How many endpoints one shop may hold.
 *
 * Five is generous against what anyone actually wires — a Zap, an n8n flow, a
 * warehouse — and tight against the thing the number is really for: every
 * endpoint multiplies the delivery rows a single order writes, and this is the
 * one table whose size grows with traffic rather than with sales. Declared
 * here rather than in the server module so the settings card can say "5" in
 * its own copy without importing anything server-only.
 */
export const MAX_ENDPOINTS_PER_SHOP = 5;

/** How many API keys one shop may hold at once, revoked ones excluded. */
export const MAX_API_KEYS_PER_SHOP = 5;

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return (
    typeof value === "string" &&
    (WEBHOOK_EVENTS as readonly string[]).includes(value)
  );
}

/**
 * Keeps a stored subscription list honest.
 *
 * The `events` column is a `text[]` the seller's form writes, and an event we
 * later rename or remove would sit in it for ever, matching nothing. Filtering
 * on read means a stale name is inert rather than a permanent, silent
 * subscription to nothing.
 */
export function knownEvents(values: readonly string[]): WebhookEvent[] {
  return values.filter(isWebhookEvent);
}

/**
 * The payload version, carried in every envelope.
 *
 * A number rather than a date, and bumped only when a field changes meaning or
 * disappears — never when one is *added*. Consumers are told in the docs that
 * new fields may appear under the same version, because the alternative is
 * every additive change breaking every Zap built on the last one.
 */
export const WEBHOOK_PAYLOAD_VERSION = 1;

export type WebhookEnvelope = {
  /** Identical to the `webhook-id` header — the consumer's idempotency key. */
  id: string;
  type: WebhookEvent;
  /** ISO 8601, when the event happened rather than when it was delivered. */
  timestamp: string;
  version: typeof WEBHOOK_PAYLOAD_VERSION;
  /**
   * True only for the "send test event" button.
   *
   * Present on every envelope rather than only on test ones, so a consumer can
   * branch on it without having to treat an absent field as false — and so
   * somebody wiring a Zap against a test payload cannot build a mapping that
   * breaks the moment a real order arrives with a different set of keys.
   */
  test: boolean;
  shop: { id: string; handle: string };
  data: Record<string, unknown>;
};

/* -------------------------------------------------------------------------- */
/*  Payloads                                                                   */
/* -------------------------------------------------------------------------- */

/** An order, in the shape `GET /api/v1/orders/{id}` also returns. */
export function orderPayload(order: Order, items: readonly OrderItem[]) {
  return orderResource(order, items);
}

/** A contact, in the shape `GET /api/v1/contacts/{id}` also returns. */
export function contactPayload(client: Client) {
  return contactResource(client);
}

/**
 * Wraps a payload in the envelope that actually goes over the wire.
 *
 * The `id` is the delivery row's own id, so the value in the body and the
 * value in the `webhook-id` header are the same string. A consumer that
 * dedupes on either one is correct, which is the point: the header is what
 * Standard Webhooks libraries hand you, and the body is what a no-code tool
 * can see.
 */
export function envelope(opts: {
  id: string;
  event: WebhookEvent;
  shop: Pick<Shop, "id" | "handle">;
  data: Record<string, unknown>;
  now: Date;
  test?: boolean;
}): WebhookEnvelope {
  return {
    id: opts.id,
    type: opts.event,
    timestamp: opts.now.toISOString(),
    version: WEBHOOK_PAYLOAD_VERSION,
    test: opts.test ?? false,
    shop: { id: opts.shop.id, handle: opts.shop.handle },
    data: opts.data,
  };
}
