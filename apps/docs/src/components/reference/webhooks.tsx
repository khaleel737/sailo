import {
  MAX_API_KEYS_PER_SHOP,
  MAX_ENDPOINTS_PER_SHOP,
  WEBHOOK_EVENTS,
  WEBHOOK_PAYLOAD_VERSION,
  type WebhookEvent,
} from "@sailo/webhooks/events";
import { AUTO_DISABLE_AFTER, MAX_ATTEMPTS, RETRY_BACKOFF_MS } from "@sailo/workflows/webhooks/policy";
import { Code, DefTable, Prose } from "./kit";

/**
 * The webhook reference: the catalogue, what each event means, and which shape
 * arrives with it.
 *
 * The list itself is `WEBHOOK_EVENTS` — the same constant the delivery code
 * filters a seller's subscriptions against, so an event that fires is an event
 * on this page and an event on this page is one that can fire.
 *
 * `EVENT_MEANINGS` below is a `Record<WebhookEvent, …>`, which is the part that
 * matters: adding an event to the catalogue fails typecheck here until somebody
 * writes down what it means. A catalogue that outruns its documentation is how
 * a seller comes to tick a box, wait for something they do not understand, and
 * wire it wrong.
 */

/* -------------------------------------------------------------------------- */
/*  Counts                                                                     */
/* -------------------------------------------------------------------------- */

export function EventCount() {
  return <>{WEBHOOK_EVENTS.length}</>;
}

/**
 * How many events share a prefix. Counted rather than typed, because "seven
 * subscription events" is a sentence that goes quietly wrong the day an eighth
 * lands — and the whole argument of that section is that they all carry one
 * shape, which is exactly the claim a stale count undermines.
 */
export function EventCountFor({ prefix }: { prefix: string }) {
  return <>{WEBHOOK_EVENTS.filter((event) => event.startsWith(prefix)).length}</>;
}

export function SubscriptionEventCount() {
  return <EventCountFor prefix="subscription." />;
}

/** The payload `version` every envelope carries. */
export function PayloadVersion() {
  return <>{WEBHOOK_PAYLOAD_VERSION}</>;
}

/** How many endpoints one shop may register. */
export function MaxEndpoints() {
  return <>{MAX_ENDPOINTS_PER_SHOP}</>;
}

/** How many live API keys one shop may hold. */
export function MaxApiKeys() {
  return <>{MAX_API_KEYS_PER_SHOP}</>;
}

/* -------------------------------------------------------------------------- */
/*  Delivery numbers                                                           */
/* -------------------------------------------------------------------------- */

/*
 * From `@sailo/workflows/webhooks/policy`, which is the module the queue
 * actually reads on every tick. A retry schedule is the number a consumer sizes
 * their own outage tolerance against, so a stale one here is worse than none:
 * it reads as a promise.
 */

/** `1m, 5m, 30m, 2h, 12h` — the gaps between attempts, in reader's units. */
export function RetrySchedule() {
  return <>{RETRY_BACKOFF_MS.map(humanDelay).join(", ")}</>;
}

/** The first attempt plus every retry. */
export function MaxAttempts() {
  return <>{MAX_ATTEMPTS}</>;
}

/** How long the whole schedule spans, rounded to the nearest hour. */
export function RetryWindow() {
  const total = RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);
  return <>{Math.round(total / 3_600_000)} hours</>;
}

/** Consecutive failures before the endpoint is switched off. */
export function AutoDisableAfter() {
  return <>{AUTO_DISABLE_AFTER}</>;
}

function humanDelay(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${minutes}m`;
  return `${minutes / 60}h`;
}

/* -------------------------------------------------------------------------- */
/*  What each event means                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One sentence per event, and `Record<WebhookEvent, …>` so there is no way to
 * add an event without adding one.
 *
 * These are the distinctions a consumer gets wrong when they are left to infer
 * meaning from a name — `cancelled` against `ended`, `payment_failed` against
 * either, an inquiry against a chargeback. Each of those is a real support
 * ticket rather than a hypothetical.
 */
const EVENT_MEANINGS: Record<WebhookEvent, string> = {
  "order.created":
    "An order exists. On a card sale this arrives together with `order.paid`, at the moment the payment lands — not when the buyer opened the checkout, because about a third of those are abandoned. On bank transfer, cash or any other manual rail it fires at checkout, before any money has moved.",
  "order.paid":
    "The money arrived. On a manual rail this is the seller confirming it, which can be days after `order.created`. This is the event to fulfil on.",
  "order.shipped":
    "The seller marked it shipped. `delivery.trackingNumber` and `delivery.trackingUrl` are populated by now if they entered any.",
  "order.cancelled": "The order was cancelled. It may or may not have been paid first — read `paymentStatus`.",
  "order.refunded":
    "Money went back. Read `refunded` against `total` rather than assuming the whole order: a partial refund fires this too.",
  "booking.confirmed":
    "An appointment was booked and confirmed. The payload is an order — the booking details are on its `booking` object.",
  "contact.created":
    "Somebody new joined the shop's list. **Not evidence of marketing consent**: read `marketingConsentAt`, which is null unless they went through a double opt-in.",
  "subscription.created": "A membership began. `status` says whether it started in a trial.",
  "subscription.renewed": "A membership renewed and was paid for. `currentPeriodEnd` has moved.",
  "subscription.payment_failed":
    "A renewal payment did not go through. **This is not an ending.** Stripe retries for a few days and most of them recover, so treat it as a reason to email rather than a reason to revoke — `subscription.ended` arrives if it never clears.",
  "subscription.plan_changed": "The member moved to a different plan or interval. `price` and `interval` are the new ones.",
  "subscription.cancelled":
    "The member asked to stop. They have paid through `currentPeriodEnd` and keep their access until it — revoking here takes away a month they already bought.",
  "subscription.resumed": "A membership that was set to cancel is running again. `cancelAtPeriodEnd` is back to false.",
  "subscription.ended":
    "The membership is actually over. **This is the one to revoke access on.**",
  "dispute.opened":
    "A buyer charged back one of the seller's sales. `dueBy` is the response deadline — usually about twenty days — and `caseType` says whether any money has moved yet. Only ever a buyer's chargeback against a seller's sale; a seller disputing their own Sailo subscription is Sailo's problem and never appears here.",
  "dispute.closed": "The case is finished. `status` says how it went, and `fundsReinstatedAt` is set if the money came back.",
};

/** Which serialised object arrives in `data`, decided by the event's prefix. */
const PAYLOAD_BY_PREFIX: { prefix: string; shape: string; href: string }[] = [
  { prefix: "order.", shape: "an order", href: "/objects/order" },
  { prefix: "booking.", shape: "an order", href: "/objects/order" },
  { prefix: "contact.", shape: "a contact", href: "/objects/contact" },
  { prefix: "subscription.", shape: "a subscription", href: "/objects/subscription" },
  { prefix: "dispute.", shape: "a dispute", href: "/objects/dispute" },
];

export function payloadFor(event: string) {
  return PAYLOAD_BY_PREFIX.find((entry) => event.startsWith(entry.prefix));
}

/* -------------------------------------------------------------------------- */
/*  Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/** Just the names, for a page that needs the catalogue and not the meanings. */
export function EventNames() {
  return (
    <ul className="ref-chips">
      {WEBHOOK_EVENTS.map((event) => (
        <li key={event}>
          <Code>{event}</Code>
        </li>
      ))}
    </ul>
  );
}

/** Every event with what it means and what arrives with it. */
export function EventReference() {
  return (
    <DefTable
      caption="Every webhook event, what it means, and the object it carries"
      headers={["Event", "What it means"]}
      rows={WEBHOOK_EVENTS.map((event) => ({
        term: event,
        note: payloadFor(event)?.shape,
        body: <Prose>{EVENT_MEANINGS[event]}</Prose>,
      }))}
    />
  );
}

/** The events beneath one prefix — the `order.*` group on the orders page. */
export function EventGroup({ prefix }: { prefix: string }) {
  const events = WEBHOOK_EVENTS.filter((event) => event.startsWith(prefix));

  return (
    <DefTable
      caption={`The ${prefix}* events`}
      headers={["Event", "What it means"]}
      rows={events.map((event) => ({ term: event, body: <Prose>{EVENT_MEANINGS[event]}</Prose> }))}
    />
  );
}

/**
 * Which shape lands in `data`, grouped rather than listed per event.
 *
 * Grouped because that is the actual rule — every event sharing a prefix
 * carries the identical object — and a sixteen-row table would hide it behind
 * repetition. A consumer that wired `subscription.created` and later adds
 * `subscription.cancelled` remaps nothing, and this table is where they can see
 * that before they start.
 */
export function PayloadShapeTable() {
  return (
    <DefTable
      caption="Which object arrives in data, by event prefix"
      headers={["Events", "`data` is"]}
      rows={PAYLOAD_BY_PREFIX.map((entry) => ({
        term: `${entry.prefix}*`,
        note: `${WEBHOOK_EVENTS.filter((event) => event.startsWith(entry.prefix)).length} events`,
        body: (
          <>
            {entry.shape} — <a href={entry.href}>see the object reference</a>
          </>
        ),
      }))}
    />
  );
}
