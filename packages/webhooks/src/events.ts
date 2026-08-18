import {
  contactResource,
  disputeResource,
  orderResource,
  subscriptionResource,
} from "@sailo/core/wire";
import type {
  Client,
  Dispute,
  Order,
  OrderItem,
  Shop,
  Subscription,
} from "@sailo/db/schema";

/**
 * What Sailo will tell an outside tool about, and exactly what it says.
 *
 * No `server-only` here, on purpose and for the same reason `segments.ts` has
 * none: the settings card renders this catalogue as checkboxes, so the
 * vocabulary has to be importable in the browser. Everything that touches the
 * database, the network or a secret lives in `@sailo/webhooks/emit`, which
 * is server-only.
 *
 * That split is also why this sits here and not in `@sailo/commerce`: the emit
 * machinery is a database write and belongs in a server-only package, but this
 * half ships to a browser in the integrations settings card and to `apps/api`,
 * which is a third bundle again. It was in `@sailo/core` for a while, because
 * that was the only package all three could reach before this one existed. A
 * package
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
 * Sixteen, and each one has a real emit point wired to it. A catalogue longer
 * than its emit points is how a seller comes to tick a box, wait for an event
 * that will never arrive, and conclude the feature is broken — so nothing is
 * listed here speculatively. `webhook-emit-sites.test.ts` in apps/web reads
 * this list against the call sites and fails when the two drift.
 *
 * Named `noun.verb`, past tense, and grouped by noun so a consumer filtering
 * on the `order.` prefix gets every order event including ones added later.
 *
 * **Why the subscription half exists.** Sailo has run memberships for as long
 * as it has run orders — the `subscriptions` table, the Stripe lifecycle
 * handlers, the renewals cron — and none of it told an outside tool anything.
 * A seller running a paid community had no way to revoke a Discord role when
 * somebody stopped paying, which is the single most-wired integration this
 * category has. The seven below are the states that arrangement can actually
 * be in, each derived from a real before-and-after comparison rather than from
 * a Stripe event name.
 *
 * **Why `cancelled` and `ended` are both here.** They are different days and
 * different consequences. `subscription.cancelled` is the member asking to
 * stop; they have paid through `currentPeriodEnd` and keep their access until
 * it. `subscription.ended` is the arrangement actually being over. A consumer
 * that revokes on the first of those takes away a month somebody bought — so
 * the catalogue makes the distinction impossible to miss rather than leaving
 * it to a `cancelAtPeriodEnd` field a Zap author will not read.
 *
 * **Why disputes are here.** A chargeback has a deadline of about twenty days
 * and the evidence that wins it usually lives in a system that is not Sailo —
 * a helpdesk, a fulfilment tool, a shipping account. `dispute.opened` is what
 * lets a seller's own tooling go and get it. Only ever emitted for a buyer's
 * chargeback against a seller's sale; a seller charging back their own Sailo
 * subscription is Sailo's money and never appears here.
 */
export const WEBHOOK_EVENTS = [
  "order.created",
  "order.paid",
  "order.shipped",
  "order.cancelled",
  "order.refunded",
  "booking.confirmed",
  "contact.created",
  "subscription.created",
  "subscription.renewed",
  "subscription.payment_failed",
  "subscription.plan_changed",
  "subscription.cancelled",
  "subscription.resumed",
  "subscription.ended",
  "dispute.opened",
  "dispute.closed",
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

/** A membership, carried identically by all seven `subscription.*` events. */
export function subscriptionPayload(subscription: Subscription) {
  return subscriptionResource(subscription);
}

/** A chargeback, carried by `dispute.opened` and `dispute.closed`. */
export function disputePayload(dispute: Dispute) {
  return disputeResource(dispute);
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
