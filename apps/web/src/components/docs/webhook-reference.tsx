import { WEBHOOK_EVENTS } from "@sailo/webhooks/events";
import { DISPUTE_FIELDS, SUBSCRIPTION_FIELDS, type PayloadField } from "./payload-fields";
import { Code, DefTable } from "./kit";

/**
 * The webhook reference: the event list, and the payload shapes behind it.
 *
 * The event list has always been generated from `WEBHOOK_EVENTS`, the same
 * constant the delivery code filters subscriptions against. The payload tables
 * are new, and they close a real hole: nine of the sixteen events — the seven
 * `subscription.*` and the two `dispute.*` — carry an object that appeared
 * nowhere in the documentation, because unlike an order or a contact there is
 * no `GET /api/v1/subscriptions/{id}` to read the shape off.
 *
 * The page told consumers otherwise. "`data` is the same object the REST API
 * returns … the full shape of each is on the REST reference" is true for the
 * five order events, for `booking.confirmed` and for `contact.created`; for the
 * other nine it sent somebody to a reference that does not describe what they
 * received.
 *
 * The field lists themselves are in `payload-fields.ts`, along with the
 * typecheck that keeps them exhaustive against the real serialisers — they live
 * apart from this file because `/llms-full.txt` renders the same data as
 * Markdown.
 */

/* -------------------------------------------------------------------------- */
/*  Events                                                                     */
/* -------------------------------------------------------------------------- */

/** How many events there are, for prose that would otherwise count by hand. */
export function EventCount() {
  return <>{WEBHOOK_EVENTS.length}</>;
}

/*
 * How many events share a prefix. Counted rather than typed, because "seven
 * subscription events" is a sentence that goes quietly wrong the day an eighth
 * lands — and the whole argument of that section is that they all carry one
 * shape, which is exactly the claim a stale count undermines.
 */
export function SubscriptionEventCount() {
  return <>{WEBHOOK_EVENTS.filter((event) => event.startsWith("subscription.")).length}</>;
}

export function EventList() {
  return (
    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
      {WEBHOOK_EVENTS.map((event) => (
        <li key={event}>
          <Code>{event}</Code>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/*  Payloads                                                                   */
/* -------------------------------------------------------------------------- */

export function SubscriptionFields() {
  return <FieldTable caption="Fields on a subscription payload" fields={SUBSCRIPTION_FIELDS} />;
}

export function DisputeFields() {
  return <FieldTable caption="Fields on a dispute payload" fields={DISPUTE_FIELDS} />;
}

function FieldTable({ caption, fields }: { caption: string; fields: readonly PayloadField[] }) {
  return (
    <DefTable
      caption={caption}
      rows={fields.map((field) => ({ term: field.name, note: field.type, body: field.body }))}
    />
  );
}
