/**
 * Every operation `/api/v1` exposes, described once.
 *
 * Three things read this file and nothing else: the documentation page, the
 * OpenAPI document, and the test that walks `app/api/v1/**` to check the three
 * agree. That is the whole point of it existing. The alternative — prose on a
 * page, a hand-kept spec file, and a route tree — is three descriptions of one
 * API, and the two that are wrong are wrong silently, because nothing compares
 * them to anything.
 *
 * **Nothing here is invented.** Filter names come from the route bodies, field
 * names from `resources.ts`, and the enumerations below are imported from the
 * constants the application itself branches on rather than copied out of them.
 * A payment status added to `PAYMENT_STATUSES` appears in these docs on the
 * same deploy, which is the property a hand-copied list can never have — the
 * MCP tool descriptions, written by hand, are already missing two of them.
 *
 * No `server-only`: this is data about the API, not part of serving it, and
 * the docs page and the drift test both need it without dragging a database
 * driver behind them.
 *
 * WHY THIS IS THREE FILES
 *
 * 661 lines, of which the catalogue was less than half: the rest was the types that
 * describe an endpoint and a page of example payloads. The catalogue is what people open
 * this file to read, so it is what is left in it.
 *
 *   ./endpoint-shape     the types, the shared params and errors, `endpointKey`
 *   ./endpoint-examples  the response bodies the docs page prints verbatim
 *   ./endpoints          every operation `/api/v1` exposes
 */

import { PRODUCT_KIND_VALUES } from "@sailo/core/variants";
import { ORDER_STATUSES } from "@sailo/core/order-status";
import { PAYMENT_STATUSES } from "@sailo/core/payment-status";
import { SUBSCRIPTION_STATUSES } from "@sailo/core/subscription-status";
import { DISPUTE_STATUSES } from "@sailo/core/disputes";
import {
  AUTOMATION_KINDS,
  AUTOMATION_STATUSES,
  RUN_STATUSES,
} from "@sailo/marketing/automations";
import { MAX_TAGS, MAX_TAG_LENGTH } from "@sailo/core/tags";
import {
  AUTH_HEADER,
  BAD_BODY,
  COMMON_ERRORS,
  CURSOR_PARAM,
  ID_PARAM,
  LIMIT_PARAM,
  ONE_ERRORS,
  PAGE_ERRORS,
  WRITE_ERROR,
  type Endpoint,
} from "./endpoint-shape";
import {
  BOOKING_EXAMPLE,
  FLOW_EXAMPLE,
  FLOW_PAGE_EXAMPLE,
  FLOW_RUN_PAGE_EXAMPLE,
  BOOKING_PAGE_EXAMPLE,
  CONTACT_EXAMPLE,
  CONTACT_LISTS_EXAMPLE,
  CONTACT_PAGE_EXAMPLE,
  CONTACT_WRITE_EXAMPLE,
  DISPUTE_EXAMPLE,
  DISPUTE_PAGE_EXAMPLE,
  LIST_EXAMPLE,
  LIST_PAGE_EXAMPLE,
  ORDER_EXAMPLE,
  ORDER_PAGE_EXAMPLE,
  PRODUCT_EXAMPLE,
  PRODUCT_PAGE_EXAMPLE,
  SHOP_EXAMPLE,
  STAFF_EXAMPLE,
  STAFF_PAGE_EXAMPLE,
  SUBSCRIPTION_EXAMPLE,
  SUBSCRIPTION_PAGE_EXAMPLE,
} from "./endpoint-examples";

export * from "./endpoint-shape";

/**
 * The memberships both `/contacts/{id}/lists` operations answer with.
 *
 * One definition because the read and the write return the same body — the
 * write's answer is a read, taken after the writes rather than assembled from
 * them — and two copies of this would be the pair that disagreed about what
 * `status` can hold.
 */
const CONTACT_LISTS_FIELD = {
  name: "lists",
  required: true,
  schema: {
    type: "array",
    items: {
      type: "object",
      required: ["id", "name", "status", "joinedAt"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        status: {
          type: "string",
          description: "`subscribed`, `pending` or `removed`.",
        },
        joinedAt: { type: ["string", "null"], format: "date-time" },
      },
    },
  },
  description:
    "Every list this contact is on, read from the database rather than assembled from what was asked for.",
} as const;

/* -------------------------------------------------------------------------- */
/*  The endpoints                                                              */
/* -------------------------------------------------------------------------- */

export const ENDPOINTS: readonly Endpoint[] = [
  {
    id: "getShop",
    method: "GET",
    path: "/shop",
    scope: "read",
    summary: "The shop this key belongs to",
    description:
      "The call to make first. It proves the credential works and names what it connected to, which is what a setup screen shows back to the seller so they know they pasted the right key. Deliberately thin — nothing about billing, nothing about the owner's account.",
    params: [],
    result: { resource: "Shop", shape: "one" },
    errors: COMMON_ERRORS,
    curl: (base) => `curl ${base}/api/v1/shop \\
  -H "${AUTH_HEADER}"`,
    successExample: SHOP_EXAMPLE,
  },

  {
    id: "listOrders",
    method: "GET",
    path: "/orders",
    scope: "read",
    summary: "Orders, newest first",
    description:
      "Keyset-paged, newest first, with line items included on every row. The three filters are the questions an integration actually asks: where the order is in fulfilment, whether the money arrived, and everything one customer has bought. An order can be paid and not yet shipped, so `status` and `payment_status` are separate questions and answering one does not answer the other.",
    params: [
      {
        name: "status",
        in: "query",
        required: false,
        schema: { type: "string", enum: [...ORDER_STATUSES] },
        description: `Fulfilment stage. One of ${ORDER_STATUSES.join(", ")}.`,
      },
      {
        name: "payment_status",
        in: "query",
        required: false,
        schema: { type: "string", enum: [...PAYMENT_STATUSES] },
        description: `Where the money stands. One of ${PAYMENT_STATUSES.join(", ")}.`,
      },
      {
        name: "email",
        in: "query",
        required: false,
        schema: { type: "string", format: "email" },
        description: "Exact customer email, matched case-insensitively.",
      },
      LIMIT_PARAM,
      CURSOR_PARAM,
    ],
    result: { resource: "Order", shape: "page" },
    errors: PAGE_ERRORS,
    curl: (base) => `curl "${base}/api/v1/orders?limit=50&payment_status=paid" \\
  -H "${AUTH_HEADER}"`,
    successExample: ORDER_PAGE_EXAMPLE,
  },

  {
    id: "getOrder",
    method: "GET",
    path: "/orders/{id}",
    scope: "read",
    summary: "One order, with line items",
    description:
      "The follow-up a webhook makes possible: `order.paid` arrives carrying the order id, and this is how a consumer that stored only the id fetches the rest. The body is identical to the webhook's `data`, so one field map works against both.",
    params: [ID_PARAM("order")],
    result: { resource: "Order", shape: "one" },
    errors: ONE_ERRORS("order"),
    curl: (base) => `curl ${base}/api/v1/orders/8f2b41d6-0c93-4f77-a1e5-9b6d2c4a7e01 \\
  -H "${AUTH_HEADER}"`,
    successExample: ORDER_EXAMPLE,
  },

  {
    id: "listProducts",
    method: "GET",
    path: "/products",
    scope: "read",
    summary: "The catalogue, newest first",
    description:
      "Variants are not expanded here — a page of twenty-five products with every variant inline is a large response nobody asked for, and the detail endpoint is one call away for the product that matters. `stock` is null on a product that does not track inventory, which means *not counted* and is not the same statement as sold out.",
    params: [
      {
        name: "kind",
        in: "query",
        required: false,
        schema: { type: "string", enum: [...PRODUCT_KIND_VALUES] },
        description: `What sort of thing it is. One of ${PRODUCT_KIND_VALUES.join(", ")}.`,
      },
      {
        name: "published",
        in: "query",
        required: false,
        schema: { type: "boolean" },
        description:
          "`true` for what buyers can see, `false` for drafts. Omitting it means both — a storefront sync wants one, a catalogue audit wants the other, and neither should have to know which we picked as a default.",
      },
      LIMIT_PARAM,
      CURSOR_PARAM,
    ],
    result: { resource: "Product", shape: "page" },
    errors: PAGE_ERRORS,
    curl: (base) => `curl "${base}/api/v1/products?published=true" \\
  -H "${AUTH_HEADER}"`,
    successExample: PRODUCT_PAGE_EXAMPLE,
  },

  {
    id: "getProduct",
    method: "GET",
    path: "/products/{id}",
    scope: "read",
    summary: "One product, with variants",
    description:
      "The same product the list returns, plus its variants and their individual stock. A variant with no price of its own inherits the product's, so `price` is always populated.",
    params: [ID_PARAM("product")],
    result: { resource: "Product", shape: "one" },
    errors: ONE_ERRORS("product"),
    curl: (base) => `curl ${base}/api/v1/products/9a7e2c11-6b48-4d0f-8e35-71c9a4f2b6d8 \\
  -H "${AUTH_HEADER}"`,
    successExample: PRODUCT_EXAMPLE,
  },

  {
    id: "listContacts",
    method: "GET",
    path: "/contacts",
    scope: "read",
    summary: "The shop's list",
    description:
      "`consented=true` is the filter that matters, and the one an integration pushing into Kit, Mailchimp or GoHighLevel must use: everybody else on this list is a customer who never agreed to be emailed. `marketingConsentAt` on each record is when they agreed, or null if they never did.",
    params: [
      {
        name: "tag",
        in: "query",
        required: false,
        schema: { type: "string", maxLength: MAX_TAG_LENGTH },
        description: "Only contacts carrying this tag. Normalised the same way stored tags are.",
      },
      {
        name: "email",
        in: "query",
        required: false,
        schema: { type: "string", format: "email" },
        description: "Exact email, matched case-insensitively.",
      },
      {
        name: "consented",
        in: "query",
        required: false,
        schema: { type: "string", enum: ["true"] },
        description:
          "`true` narrows to people who opted in to marketing email. Any other value is treated as absent — there is no way to ask for *only* the non-consenting, because that is not a list anyone should be assembling.",
      },
      LIMIT_PARAM,
      CURSOR_PARAM,
    ],
    result: { resource: "Contact", shape: "page" },
    errors: [
      { code: "invalid_request", when: "`tag` normalises to nothing we could have stored." },
      ...PAGE_ERRORS,
    ],
    curl: (base) => `curl "${base}/api/v1/contacts?consented=true&limit=100" \\
  -H "${AUTH_HEADER}"`,
    successExample: CONTACT_PAGE_EXAMPLE,
  },

  {
    id: "createContact",
    method: "POST",
    path: "/contacts",
    scope: "write",
    summary: "Create or update a contact",
    description:
      "The write that lets a form on your own site, a Typeform, or any Zapier action feed Sailo. Idempotent by person rather than by call: sending somebody twice updates them and merges their tags instead of duplicating or failing. A name only ever fills a gap — it never overwrites one the seller or an order already knows.",
    params: [],
    body: {
      fields: [
        {
          name: "email",
          required: false,
          schema: { type: "string", format: "email" },
          description: "Required unless `phone` is given.",
        },
        {
          name: "phone",
          required: false,
          schema: { type: "string" },
          description: "Required unless `email` is given. Normalised before storage.",
        },
        {
          name: "name",
          required: false,
          schema: { type: "string" },
          description: "Falls back to the email, then the phone, then `Contact`.",
        },
        {
          name: "tags",
          required: false,
          schema: { type: "array", items: { type: "string", maxLength: MAX_TAG_LENGTH } },
          description: `Merged with any tags they already carry; never replaces them. At most ${MAX_TAGS} are kept, and the response says which.`,
        },
        {
          name: "sendOptIn",
          required: false,
          schema: { type: "boolean" },
          description:
            "Email this person the same double opt-in link the public signup form uses. Needs an email address. Rate-limited per address, so a `false` in `optInSent` can mean *asked too often* rather than *failed*.",
        },
      ],
      example: `{
  "email": "ada@example.com",
  "name": "Ada",
  "tags": ["webinar"],
  "sendOptIn": true
}`,
    },
    result: { resource: "Contact", shape: "one" },
    resultExtra: [
      {
        name: "optInSent",
        required: true,
        schema: { type: "boolean" },
        description: "Whether the confirmation email actually went out.",
      },
    ],
    errors: [
      { code: "invalid_request", when: "Neither `email` nor `phone`, or an email we cannot store." },
      BAD_BODY,
      WRITE_ERROR,
      ...COMMON_ERRORS,
    ],
    curl: (base) => `curl -X POST ${base}/api/v1/contacts \\
  -H "${AUTH_HEADER}" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"ada@example.com","name":"Ada","tags":["webinar"],"sendOptIn":true}'`,
    successExample: CONTACT_WRITE_EXAMPLE,
  },

  {
    id: "getContact",
    method: "GET",
    path: "/contacts/{id}",
    scope: "read",
    summary: "One contact",
    description:
      "One person on the list, with their tags and consent state. The seller's private `notes` column is deliberately absent — it is a scratchpad about a customer, and the last thing that should sync into a third-party CRM.",
    params: [ID_PARAM("contact")],
    result: { resource: "Contact", shape: "one" },
    errors: ONE_ERRORS("contact"),
    curl: (base) => `curl ${base}/api/v1/contacts/c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f \\
  -H "${AUTH_HEADER}"`,
    successExample: CONTACT_EXAMPLE,
  },

  {
    id: "tagContact",
    method: "POST",
    path: "/contacts/{id}/tags",
    scope: "write",
    summary: "Add and remove tags",
    description:
      "Its own endpoint rather than a field on the upsert, because this is what an automation actually wants to do — *tag everyone who turned up* — and routing it through the upsert would mean sending a name and an email you may not have just to change a label. Add and remove, never replace: a tag the seller put on somebody by hand is not something an automation should delete by omitting it.",
    params: [ID_PARAM("contact")],
    body: {
      fields: [
        {
          name: "add",
          required: false,
          schema: { type: "array", items: { type: "string", maxLength: MAX_TAG_LENGTH } },
          description: "Tags to add. Already-present tags are left alone.",
        },
        {
          name: "remove",
          required: false,
          schema: { type: "array", items: { type: "string", maxLength: MAX_TAG_LENGTH } },
          description: "Tags to take off. Absent tags are not an error.",
        },
      ],
      example: `{
  "add": ["vip", "attended"],
  "remove": ["lead"]
}`,
    },
    result: { resource: "Contact", shape: "one" },
    errors: [
      { code: "invalid_request", when: "Neither `add` nor `remove` carried a usable tag." },
      BAD_BODY,
      { code: "not_found", when: "No contact with that id in this shop." },
      WRITE_ERROR,
      ...COMMON_ERRORS,
    ],
    curl: (base) => `curl -X POST ${base}/api/v1/contacts/c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f/tags \\
  -H "${AUTH_HEADER}" \\
  -H "Content-Type: application/json" \\
  -d '{"add":["vip"],"remove":["lead"]}'`,
    successExample: CONTACT_EXAMPLE,
  },

  {
    id: "listLists",
    method: "GET",
    path: "/lists",
    scope: "read",
    summary: "The shop's lists, with their real audience",
    description:
      "Tags say what a contact is; lists say what they will be sent. The two counts answer different questions and adding them together overstates every list a seller has: `subscribedCount` is who a broadcast would actually reach, and `pendingCount` is who was added to a double opt-in list and has not yet clicked the link in their own inbox. A pending member is on the list and is not a recipient. Neither count includes people who left.",
    params: [LIMIT_PARAM, CURSOR_PARAM],
    result: { resource: "List", shape: "page" },
    errors: PAGE_ERRORS,
    curl: (base) => `curl ${base}/api/v1/lists \\
  -H "${AUTH_HEADER}"`,
    successExample: LIST_PAGE_EXAMPLE,
  },

  {
    id: "getList",
    method: "GET",
    path: "/lists/{id}",
    scope: "read",
    summary: "One list",
    description:
      "The same object the list endpoint returns. `doubleOptIn` is the field worth reading before writing anything: on a list that asks for confirmation, adding somebody produces a `pending` membership and no amount of asking will produce a subscriber.",
    params: [ID_PARAM("list")],
    result: { resource: "List", shape: "one" },
    errors: ONE_ERRORS("list"),
    curl: (base) => `curl ${base}/api/v1/lists/b8c1a057-3e62-4d19-9f74-5a0c8b2e6d13 \\
  -H "${AUTH_HEADER}"`,
    successExample: LIST_EXAMPLE,
  },

  {
    id: "getContactLists",
    method: "GET",
    path: "/contacts/{id}/lists",
    scope: "read",
    summary: "Which lists a contact is on",
    description:
      "Its own endpoint rather than a field on the contact, because it is a join every caller would otherwise pay for on every read — and most reads here are a mirror that wants the person, not their memberships. The `status` on each membership is the whole value of it: `subscribed` will receive the next broadcast, `pending` will not, and `removed` is somebody who left and is kept only so the next import does not quietly put them back.",
    params: [ID_PARAM("contact")],
    result: { resource: "Contact", shape: "one" },
    resultExtra: [CONTACT_LISTS_FIELD],
    errors: ONE_ERRORS("contact"),
    curl: (base) => `curl ${base}/api/v1/contacts/c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f/lists \\
  -H "${AUTH_HEADER}"`,
    successExample: CONTACT_LISTS_EXAMPLE,
  },

  {
    id: "updateContactLists",
    method: "POST",
    path: "/contacts/{id}/lists",
    scope: "write",
    summary: "Put a contact on lists, or take them off",
    description:
      "The list counterpart of the tags endpoint, and the same shape for the same reason: join and leave rather than replace, because a membership the seller created by hand is not something an automation should delete by omitting it. Joining cannot manufacture a subscriber — on a double opt-in list the membership lands as `pending` until the person clicks the link in their own inbox — so the response reports the state each membership actually settled in rather than the state you asked for. Leaving marks the membership `removed`; it does not delete it and it does not suppress the address, which is a different verb that ends every list at once.",
    params: [ID_PARAM("contact")],
    body: {
      fields: [
        {
          name: "join",
          required: false,
          schema: { type: "array", items: { type: "string", format: "uuid" } },
          description:
            "Lists to put them on. A list id that is not this shop's is ignored rather than an error, and a list they are already on is left exactly as it is — a re-join never demotes a subscriber to pending.",
        },
        {
          name: "leave",
          required: false,
          schema: { type: "array", items: { type: "string", format: "uuid" } },
          description:
            "Lists to take them off. Sending the same id in both arrays leaves them off it: removal is the safer half of a contradiction to honour.",
        },
      ],
      example: `{
  "join": ["b8c1a057-3e62-4d19-9f74-5a0c8b2e6d13"],
  "leave": []
}`,
    },
    result: { resource: "Contact", shape: "one" },
    resultExtra: [CONTACT_LISTS_FIELD],
    errors: [
      { code: "invalid_request", when: "Neither `join` nor `leave`, or a list id that is not uuid-shaped." },
      BAD_BODY,
      { code: "not_found", when: "No contact with that id in this shop." },
      WRITE_ERROR,
      ...COMMON_ERRORS,
    ],
    curl: (base) => `curl -X POST ${base}/api/v1/contacts/c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f/lists \\
  -H "${AUTH_HEADER}" \\
  -H "Content-Type: application/json" \\
  -d '{"join":["b8c1a057-3e62-4d19-9f74-5a0c8b2e6d13"]}'`,
    successExample: CONTACT_LISTS_EXAMPLE,
  },

  {
    id: "listSubscriptions",
    method: "GET",
    path: "/subscriptions",
    scope: "read",
    summary: "Memberships, newest first",
    description:
      "What the seven `subscription.*` webhooks have been arriving without: somewhere to resolve the id they carry. `billingMode` is the field to read before concluding anything about renewal — a `manual` membership is one Sailo raises renewal orders for and a human settles at the door, so nothing will ever arrive from Stripe about it and an integration waiting for a card renewal on one waits for ever.",
    params: [
      {
        name: "status",
        in: "query",
        required: false,
        schema: { type: "string", enum: [...SUBSCRIPTION_STATUSES] },
        description: `Where the membership stands. One of ${SUBSCRIPTION_STATUSES.join(", ")}.`,
      },
      {
        name: "product_id",
        in: "query",
        required: false,
        schema: { type: "string", format: "uuid" },
        description: "Only memberships to this product.",
      },
      {
        name: "contact_id",
        in: "query",
        required: false,
        schema: { type: "string", format: "uuid" },
        description: "Only memberships held by this contact.",
      },
      LIMIT_PARAM,
      CURSOR_PARAM,
    ],
    result: { resource: "Subscription", shape: "page" },
    errors: [
      { code: "invalid_request", when: "`product_id` or `contact_id` is not uuid-shaped." },
      ...PAGE_ERRORS,
    ],
    curl: (base) => `curl "${base}/api/v1/subscriptions?status=active" \\
  -H "${AUTH_HEADER}"`,
    successExample: SUBSCRIPTION_PAGE_EXAMPLE,
  },

  {
    id: "getSubscription",
    method: "GET",
    path: "/subscriptions/{id}",
    scope: "read",
    summary: "One membership",
    description:
      "Identical to the `data` of every `subscription.*` webhook, so one field map works against both. Revoke access on `currentPeriodEnd`, never on `canceledAt`: a cancelled member has paid through the end of the period and keeps what they bought until it.",
    params: [ID_PARAM("subscription")],
    result: { resource: "Subscription", shape: "one" },
    errors: ONE_ERRORS("subscription"),
    curl: (base) => `curl ${base}/api/v1/subscriptions/5e8a1c73-2d94-4b16-8f07-3c9e6b0a1d42 \\
  -H "${AUTH_HEADER}"`,
    successExample: SUBSCRIPTION_EXAMPLE,
  },

  {
    id: "listDisputes",
    method: "GET",
    path: "/disputes",
    scope: "read",
    summary: "Chargebacks against this shop's sales",
    description:
      "A chargeback gives about twenty days to respond, and the evidence that wins it usually lives somewhere that is not Sailo — a helpdesk, a fulfilment tool, a shipping account. This is what lets a seller's own tooling go and fetch it. Only ever a buyer disputing a seller's sale: a seller charging back their own Sailo subscription is our money and our problem, and it never appears here however the request is phrased.",
    params: [
      {
        name: "status",
        in: "query",
        required: false,
        schema: { type: "string", enum: [...DISPUTE_STATUSES] },
        description: `Stripe's own status. One of ${DISPUTE_STATUSES.join(", ")}.`,
      },
      {
        name: "order_id",
        in: "query",
        required: false,
        schema: { type: "string", format: "uuid" },
        description: "Only disputes against this order.",
      },
      LIMIT_PARAM,
      CURSOR_PARAM,
    ],
    result: { resource: "Dispute", shape: "page" },
    errors: [
      { code: "invalid_request", when: "`order_id` is not uuid-shaped." },
      ...PAGE_ERRORS,
    ],
    curl: (base) => `curl "${base}/api/v1/disputes?status=needs_response" \\
  -H "${AUTH_HEADER}"`,
    successExample: DISPUTE_PAGE_EXAMPLE,
  },

  {
    id: "getDispute",
    method: "GET",
    path: "/disputes/{id}",
    scope: "read",
    summary: "One chargeback",
    description:
      "Identical to the `data` of `dispute.opened` and `dispute.closed`. `caseType` is the field that decides whether any of this has cost anything yet: an `inquiry` is the issuer asking a question and no money has moved, while a `chargeback` has already taken `deducted` — the amount plus the fee — out of the seller's balance. The evidence bundle itself is deliberately absent; `completenessBp` says how strong the response was without shipping the response.",
    params: [ID_PARAM("dispute")],
    result: { resource: "Dispute", shape: "one" },
    errors: ONE_ERRORS("dispute"),
    curl: (base) => `curl ${base}/api/v1/disputes/7b3f9d21-6c05-4e88-9a12-4d7e2f8b3c60 \\
  -H "${AUTH_HEADER}"`,
    successExample: DISPUTE_EXAMPLE,
  },

  {
    id: "listBookings",
    method: "GET",
    path: "/bookings",
    scope: "read",
    summary: "Appointments, newest booked first",
    description:
      "The diary, for a calendar that is not ours. Ordered newest-booked first like every other list here and windowed with `from`/`to` rather than sorted by start time, because the two questions an integration asks are *what has been booked since I last looked* — which is this order — and *what is in the diary next week*, which is the window. `isExclusive` is the field that decides what an entry means: an exclusive booking holds the whole slot, while several non-exclusive ones are seats in the same class and do not conflict. Mirroring them all as busy double-books a teacher out of their own class.",
    params: [
      {
        name: "product_id",
        in: "query",
        required: false,
        schema: { type: "string", format: "uuid" },
        description: "Only appointments for this service.",
      },
      {
        name: "staff_id",
        in: "query",
        required: false,
        schema: { type: "string", format: "uuid" },
        description: "Only appointments taken by this person on the roster.",
      },
      {
        name: "from",
        in: "query",
        required: false,
        schema: { type: "string", format: "date-time" },
        description:
          "ISO 8601. Appointments starting at or after this instant. The window is on when an appointment starts, not on overlap — one that began earlier and runs into it is not in the answer.",
      },
      {
        name: "to",
        in: "query",
        required: false,
        schema: { type: "string", format: "date-time" },
        description: "ISO 8601, exclusive. Appointments starting strictly before it.",
      },
      LIMIT_PARAM,
      CURSOR_PARAM,
    ],
    result: { resource: "Booking", shape: "page" },
    errors: [
      { code: "invalid_request", when: "`from` or `to` is not a timestamp we can read, or an id is not uuid-shaped." },
      ...PAGE_ERRORS,
    ],
    curl: (base) => `curl "${base}/api/v1/bookings?from=2026-08-24T00:00:00Z&to=2026-08-31T00:00:00Z" \\
  -H "${AUTH_HEADER}"`,
    successExample: BOOKING_PAGE_EXAMPLE,
  },

  {
    id: "getBooking",
    method: "GET",
    path: "/bookings/{id}",
    scope: "read",
    summary: "One appointment",
    description:
      "There is no status on a booking. A slot is given back by removing the claim, so an appointment that is still here is one that still stands, and one that has disappeared from a later page is how you learn it was cancelled or refunded. `staffId` is null on a shop that books the shop rather than a named person.",
    params: [ID_PARAM("booking")],
    result: { resource: "Booking", shape: "one" },
    errors: ONE_ERRORS("booking"),
    curl: (base) => `curl ${base}/api/v1/bookings/2a6d8f30-91b4-4c27-8e53-0f1a7c6b9d84 \\
  -H "${AUTH_HEADER}"`,
    successExample: BOOKING_EXAMPLE,
  },

  {
    id: "listStaff",
    method: "GET",
    path: "/staff",
    scope: "read",
    summary: "The bookable roster",
    description:
      "The people a buyer can pick when they book. **Not logins and not the seller's colleagues** — a staff resource is a name on a roster with no account and no access to anything, and anything reading it as an identity is reading it wrong. The seller's private external calendar link is deliberately absent: it is a credential wearing a URL's clothes, and this API returns no credentials.",
    params: [
      {
        name: "active",
        in: "query",
        required: false,
        schema: { type: "boolean" },
        description:
          "`true` for who can be booked right now, `false` for who has been stood down. Omitting it means both — an inactive person can still be the `staffId` on an appointment already in the diary, which is exactly why taking somebody off the roster does not delete them.",
      },
      LIMIT_PARAM,
      CURSOR_PARAM,
    ],
    result: { resource: "Staff", shape: "page" },
    errors: PAGE_ERRORS,
    curl: (base) => `curl "${base}/api/v1/staff?active=true" \\
  -H "${AUTH_HEADER}"`,
    successExample: STAFF_PAGE_EXAMPLE,
  },

  {
    id: "getStaff",
    method: "GET",
    path: "/staff/{id}",
    scope: "read",
    summary: "One person on the roster",
    description:
      "`timeZone` null means the shop's own zone rather than UTC, which matters because it is the zone the appointment times on `/bookings` should be read in. `position` is where the seller put them in their own ordering of the roster.",
    params: [ID_PARAM("staff member")],
    result: { resource: "Staff", shape: "one" },
    errors: ONE_ERRORS("staff member"),
    curl: (base) => `curl ${base}/api/v1/staff/6d4b2e19-7a30-4f85-b1c6-2e8d5a3f0b71 \\
  -H "${AUTH_HEADER}"`,
    successExample: STAFF_EXAMPLE,
  },

  {
    id: "listFlows",
    method: "GET",
    path: "/flows",
    scope: "read",
    summary: "Automations, newest first",
    description:
      "The sequences a seller built once and left running — somebody joins a list, wait two days, send this. `kind` defaults to `email`, which is the sequences the builder draws; pass `scenario` for the one-step rules wired to an outside app. They are separate on purpose, because they are separate screens to a seller and folding them together would hand you a count of \"my flows\" they have never seen. `runs` is null here: counting who is inside each flow is a query against a table that grows with every contact who ever entered one, and a page of twenty-five should not pay for it. Fetch one flow to get its tallies.",
    params: [
      {
        name: "kind",
        in: "query",
        required: false,
        schema: { type: "string", enum: [...AUTOMATION_KINDS] },
        description: `What sort of automation. One of ${AUTOMATION_KINDS.join(", ")}. Defaults to \`email\`.`,
      },
      {
        name: "status",
        in: "query",
        required: false,
        schema: { type: "string", enum: [...AUTOMATION_STATUSES] },
        description: `One of ${AUTOMATION_STATUSES.join(", ")}. Only \`active\` enrols anybody.`,
      },
      LIMIT_PARAM,
      CURSOR_PARAM,
    ],
    result: { resource: "Flow", shape: "page" },
    errors: [
      { code: "forbidden", when: "The shop's plan does not include automations." },
      ...PAGE_ERRORS,
    ],
    curl: (base) => `curl "${base}/api/v1/flows?status=active" \\
  -H "${AUTH_HEADER}"`,
    successExample: FLOW_PAGE_EXAMPLE,
  },

  {
    id: "getFlow",
    method: "GET",
    path: "/flows/{id}",
    scope: "read",
    summary: "One automation, with how it is going",
    description:
      "The same flow the list returns, plus `runs` — every contact who has ever entered, split by where they got to. `live` is queued plus waiting together, because both are people still inside the sequence and the only difference between them is whether a timer is currently running. `steps` is the ordered node list with each node's kind; the node bodies themselves are deliberately not published, because they are the shape the builder and the runner agree on and reconstructing \"what this flow does\" from them would mean reimplementing the parser against something that is ours to change.",
    params: [ID_PARAM("flow")],
    result: { resource: "Flow", shape: "one" },
    errors: [
      { code: "forbidden", when: "The shop's plan does not include automations." },
      ...ONE_ERRORS("flow"),
    ],
    curl: (base) => `curl ${base}/api/v1/flows/d4e5f6a7-8b9c-4d0e-1f2a-3b4c5d6e7f80 \\
  -H "${AUTH_HEADER}"`,
    successExample: FLOW_EXAMPLE,
  },

  {
    id: "listFlowRuns",
    method: "GET",
    path: "/flows/{id}/runs",
    scope: "read",
    summary: "Who walked a flow, and where they got to",
    description:
      "The read that answers *why did this customer not get the email*. Each run is one person moving through one flow: `currentStep` is the node they are sitting on, `wakeAt` is when the runner will next look at them, and `lastError` is the reason a failed one stopped. Filter by `email` to answer the question about one person directly. Ordered by when somebody entered, newest first — this table records no other time, so that is what the cursor is built over.",
    params: [
      ID_PARAM("flow"),
      {
        name: "status",
        in: "query",
        required: false,
        schema: { type: "string", enum: [...RUN_STATUSES] },
        description: `Where the run stands. One of ${RUN_STATUSES.join(", ")}. \`queued\` and \`waiting\` are both still inside the flow.`,
      },
      {
        name: "email",
        in: "query",
        required: false,
        schema: { type: "string", format: "email" },
        description: "Exact address, matched case-insensitively. The fastest way to answer a question about one customer.",
      },
      LIMIT_PARAM,
      CURSOR_PARAM,
    ],
    result: { resource: "FlowRun", shape: "page" },
    errors: [
      { code: "forbidden", when: "The shop's plan does not include automations." },
      ...ONE_ERRORS("flow"),
    ],
    curl: (base) => `curl "${base}/api/v1/flows/d4e5f6a7-8b9c-4d0e-1f2a-3b4c5d6e7f80/runs?status=failed" \\
  -H "${AUTH_HEADER}"`,
    successExample: FLOW_RUN_PAGE_EXAMPLE,
  },
] as const;
