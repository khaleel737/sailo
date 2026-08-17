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
  CONTACT_EXAMPLE,
  CONTACT_PAGE_EXAMPLE,
  CONTACT_WRITE_EXAMPLE,
  ORDER_EXAMPLE,
  ORDER_PAGE_EXAMPLE,
  PRODUCT_EXAMPLE,
  PRODUCT_PAGE_EXAMPLE,
  SHOP_EXAMPLE,
} from "./endpoint-examples";

export * from "./endpoint-shape";

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
] as const;
