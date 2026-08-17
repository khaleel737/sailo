import { PRODUCT_KIND_VALUES } from "@sailo/core/variants";
import { ORDER_STATUSES } from "@sailo/core/order-status";
import { PAYMENT_STATUSES } from "@sailo/core/payment-status";
import { MAX_TAGS, MAX_TAG_LENGTH } from "@sailo/customers/tags";
import { DEFAULT_LIMIT, MAX_LIMIT, type ApiErrorCode } from "./respond";
import type { ApiScope } from "./keys";

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
 */

/* -------------------------------------------------------------------------- */
/*  Shape                                                                      */
/* -------------------------------------------------------------------------- */

export type EndpointParam = {
  name: string;
  in: "path" | "query";
  required: boolean;
  /** JSON Schema, used verbatim by the OpenAPI document. */
  schema: Record<string, unknown>;
  description: string;
};

export type BodyField = {
  name: string;
  required: boolean;
  schema: Record<string, unknown>;
  description: string;
};

export type EndpointError = { code: ApiErrorCode; when: string };

/** The `components/schemas` name a response carries. */
export type ResourceName = "Shop" | "Order" | "Product" | "Contact";

export type Endpoint = {
  /** Stable anchor and OpenAPI `operationId`. Never renamed — docs deep-link to it. */
  id: string;
  method: "GET" | "POST";
  /** Path beneath `/api/v1`, with OpenAPI-style `{id}` placeholders. */
  path: string;
  /** The scope a key needs. `write` implies the key also carries `read`. */
  scope: ApiScope;
  /** One line, for the index table. */
  summary: string;
  /** The paragraph on the endpoint's own entry. */
  description: string;
  params: readonly EndpointParam[];
  body?: { fields: readonly BodyField[]; example: string };
  result: { resource: ResourceName; shape: "one" | "page" };
  /** Fields this endpoint adds on top of the bare resource. */
  resultExtra?: readonly BodyField[];
  errors: readonly EndpointError[];
  curl: (base: string) => string;
  /** A real response body, trimmed with `…` where a full one would not be read. */
  successExample: string;
};

/* -------------------------------------------------------------------------- */
/*  Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The refusals every authenticated route can produce, in the order a caller
 * meets them: no key, a key the plan or the scope does not allow, too many
 * calls, and our own fault.
 *
 * Listed on every endpoint rather than mentioned once at the top, because the
 * thing consuming this is often a generator or a model reading one operation
 * in isolation — and "see the introduction" is not something either can act on.
 */
const COMMON_ERRORS: readonly EndpointError[] = [
  { code: "unauthorized", when: "No `Authorization` header, or a key we do not recognise." },
  {
    code: "forbidden",
    when: "A real key, but the shop's plan does not include the API.",
  },
  { code: "rate_limited", when: "Too many calls on this key. Slow down and retry." },
  { code: "server_error", when: "Our fault. The body says nothing about the cause; retry." },
] as const;

const WRITE_ERROR: EndpointError = {
  code: "forbidden",
  when: "The key is read-only. Mint one with write access.",
};

/**
 * The request-body ceiling, from `readJson` in `./route.ts`.
 *
 * Stated here rather than imported because the literal lives inside that
 * function, and exporting it would mean editing a module that is being moved
 * out into its own package by another change in flight. `endpoints.test.ts`
 * reads that file and fails if the two ever disagree, so the number is pinned
 * even though it is not shared.
 */
export const MAX_BODY_KB = 64;

const BAD_BODY: EndpointError = {
  code: "invalid_request",
  when: `The body is not a JSON object, or is over ${MAX_BODY_KB} KB.`,
};

const LIMIT_PARAM: EndpointParam = {
  name: "limit",
  in: "query",
  required: false,
  schema: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
  description: `How many to return. Defaults to ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT} — asking for more is clamped, not refused.`,
};

const CURSOR_PARAM: EndpointParam = {
  name: "cursor",
  in: "query",
  required: false,
  schema: { type: "string" },
  description:
    "The `next_cursor` from the previous page. Omit for the first page. A cursor we did not issue is a 400, not an empty page.",
};

const ID_PARAM = (what: string): EndpointParam => ({
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
  description: `The ${what} id.`,
});

const PAGE_ERRORS: readonly EndpointError[] = [
  { code: "invalid_request", when: "`cursor` is not one we issued." },
  ...COMMON_ERRORS,
] as const;

const ONE_ERRORS = (what: string): readonly EndpointError[] =>
  [
    { code: "not_found" as const, when: `No ${what} with that id in this shop.` },
    ...COMMON_ERRORS,
  ] as const;

/** `Authorization: Bearer …` on every call, and the reason it is never elsewhere. */
export const AUTH_HEADER = "Authorization: Bearer sailo_sk_…";

/* -------------------------------------------------------------------------- */
/*  Response examples                                                          */
/* -------------------------------------------------------------------------- */

const SHOP_EXAMPLE = `{
  "data": {
    "id": "3f1c9a80-5e17-4a2b-9c44-2f0d8b71e6a3",
    "object": "shop",
    "handle": "acme",
    "name": "Acme Supply",
    "currency": "GBP",
    "timeZone": "Europe/London",
    "createdAt": "2026-01-09T11:02:44.108Z"
  }
}`;

const ORDER_EXAMPLE = `{
  "data": {
    "id": "8f2b41d6-0c93-4f77-a1e5-9b6d2c4a7e01",
    "object": "order",
    "status": "confirmed",
    "paymentStatus": "paid",
    "paymentMethod": "card",
    "currency": "GBP",
    "subtotal":    { "cents": 4999, "amount": "49.99", "currency": "GBP" },
    "discount":    { "cents": 0,    "amount": "0.00",  "currency": "GBP" },
    "deliveryFee": { "cents": 499,  "amount": "4.99",  "currency": "GBP" },
    "tax":         { "cents": 0,    "amount": "0.00",  "currency": "GBP" },
    "total":       { "cents": 5498, "amount": "54.98", "currency": "GBP" },
    "refunded":    { "cents": 0,    "amount": "0.00",  "currency": "GBP" },
    "itemCount": 1,
    "customer": {
      "clientId": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "phone": null
    },
    "address": {
      "line1": "12 Dean Street", "line2": null, "city": "London",
      "region": null, "postalCode": "W1D 3RN", "country": "GB"
    },
    "delivery": {
      "method": "shipping", "label": "Standard", "pickupLocation": null,
      "trackingCarrier": null, "trackingNumber": null, "trackingUrl": null,
      "shippedAt": null
    },
    "booking": null,
    "coupon": { "code": "LAUNCH10" },
    "affiliate": null,
    "note": null,
    "items": [
      {
        "id": "1b0c…", "productId": "9a7e…", "variantId": null,
        "title": "Sourdough loaf", "variantLabel": null, "sku": "SD-01",
        "kind": "physical", "quantity": 1,
        "unitPrice": { "cents": 4999, "amount": "49.99", "currency": "GBP" },
        "subtotal":  { "cents": 4999, "amount": "49.99", "currency": "GBP" }
      }
    ],
    "createdAt": "2026-08-12T09:41:07.221Z",
    "updatedAt": "2026-08-12T09:41:09.884Z"
  }
}`;

const ORDER_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "8f2b41d6-0c93-4f77-a1e5-9b6d2c4a7e01",
      "object": "order",
      "status": "confirmed",
      "paymentStatus": "paid",
      "total": { "cents": 5498, "amount": "54.98", "currency": "GBP" },
      "customer": { "clientId": "c1d2…", "name": "Ada Lovelace", "email": "ada@example.com", "phone": null },
      "items": [ /* … */ ]
      /* … every field GET /orders/{id} returns … */
    }
  ],
  "has_more": true,
  "next_cursor": "MjAyNi0wOC0xMlQwOTo0MTowNy4yMjFafDhmMmI"
}`;

const PRODUCT_EXAMPLE = `{
  "data": {
    "id": "9a7e2c11-6b48-4d0f-8e35-71c9a4f2b6d8",
    "object": "product",
    "title": "Sourdough loaf",
    "slug": "sourdough-loaf",
    "description": "Baked the night before.",
    "kind": "physical",
    "tags": ["bread"],
    "price":     { "cents": 4999, "amount": "49.99", "currency": "GBP" },
    "compareAt": null,
    "trackInventory": true,
    "stock": 12,
    "inStock": true,
    "isPublished": true,
    "isFeatured": false,
    "booking": null,
    "event": null,
    "membership": null,
    "variants": [
      {
        "id": "4c5d…",
        "sku": "SD-01-L",
        "options": { "Size": "Large" },
        "price": { "cents": 5499, "amount": "54.99", "currency": "GBP" },
        "stock": 4,
        "isAvailable": true
      }
    ],
    "createdAt": "2026-03-02T08:15:00.000Z",
    "updatedAt": "2026-08-01T16:20:31.442Z"
  }
}`;

const CONTACT_EXAMPLE = `{
  "data": {
    "id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "object": "contact",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": null,
    "tags": ["webinar"],
    "source": "api",
    "marketingConsentAt": null,
    "address": {
      "line1": null, "line2": null, "city": null,
      "region": null, "postalCode": null, "country": null
    },
    "createdAt": "2026-08-12T09:41:07.221Z",
    "updatedAt": "2026-08-12T09:41:07.221Z"
  }
}`;

const PRODUCT_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "9a7e2c11-6b48-4d0f-8e35-71c9a4f2b6d8",
      "object": "product",
      "title": "Sourdough loaf",
      "slug": "sourdough-loaf",
      "kind": "physical",
      "price": { "cents": 4999, "amount": "49.99", "currency": "GBP" },
      "stock": 12,
      "inStock": true,
      "isPublished": true,
      "variants": []
      /* … every field GET /products/{id} returns, minus the variants … */
    }
  ],
  "has_more": false,
  "next_cursor": null
}`;

const CONTACT_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
      "object": "contact",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "phone": null,
      "tags": ["webinar"],
      "source": "api",
      "marketingConsentAt": "2026-08-12T10:03:55.700Z"
      /* … every field GET /contacts/{id} returns … */
    }
  ],
  "has_more": false,
  "next_cursor": null
}`;

const CONTACT_WRITE_EXAMPLE = `{
  "data": {
    "id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "object": "contact",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": null,
    "tags": ["webinar"],
    "source": "api",
    "marketingConsentAt": null,
    "address": { "line1": null, "line2": null, "city": null, "region": null, "postalCode": null, "country": null },
    "createdAt": "2026-08-12T09:41:07.221Z",
    "updatedAt": "2026-08-12T09:41:07.221Z",
    "optInSent": true
  }
}`;

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

/* -------------------------------------------------------------------------- */
/*  Lookups                                                                    */
/* -------------------------------------------------------------------------- */

/** `GET /orders/{id}` — the form both the docs anchors and the drift test key on. */
export function endpointKey(endpoint: Pick<Endpoint, "method" | "path">): string {
  return `${endpoint.method} ${endpoint.path}`;
}
