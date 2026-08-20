import { docsUrl } from "@sailo/core/origin";
import { PRODUCT_KIND_VALUES } from "@sailo/core/variants";
import { ORDER_STATUSES } from "@sailo/core/order-status";
import { PAYMENT_STATUSES } from "@sailo/core/payment-status";
import { SUBSCRIPTION_STATUSES } from "@sailo/core/subscription-status";
import { DISPUTE_CASE_TYPES, DISPUTE_STATUSES } from "@sailo/core/disputes";
import {
  AUTOMATION_KINDS,
  AUTOMATION_STATUSES,
  NODE_KINDS,
  RUN_STATUSES,
} from "@sailo/marketing/automations";
import { ENDPOINTS, type Endpoint, type ResourceName } from "./endpoints";
import { API_ERROR_CODES, API_VERSION, MAX_LIMIT } from "./respond";

/**
 * The OpenAPI 3.1 description of `/api/v1`.
 *
 * Hand-authored rather than derived, because there is nothing to derive it
 * from: the handlers take plain TypeScript types and read the query string by
 * hand, so no schema exists at runtime to reflect over. Generating it from
 * `zod` would mean rewriting the routes around a validator, which is a change
 * to how requests are handled, not to how they are documented.
 *
 * What keeps a hand-written document honest is the test rather than the
 * authoring: `endpoints.test.ts` walks `app/api/v1/**` and fails if a route
 * exists that this does not describe, or if this describes one that does not
 * exist. The paths and parameters below come out of `ENDPOINTS`, so the docs
 * page and this file cannot disagree about them either — only the schemas here
 * are typed out, and those are pinned against `resources.ts` by eye and by the
 * examples on the docs page.
 */

/* -------------------------------------------------------------------------- */
/*  Schemas                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * In 3.1 a nullable field is a type union, not `nullable: true` — that keyword
 * was 3.0's and validators reject it here.
 */
const nullable = (type: string, extra: Record<string, unknown> = {}) => ({
  type: [type, "null"],
  ...extra,
});

const MONEY = {
  type: "object",
  description:
    "Always an object, never a bare number. `cents` is the integer to do arithmetic on and is correct for zero-decimal currencies like JPY, where dividing by 100 is not. `amount` is for anything a person will read.",
  required: ["cents", "amount", "currency"],
  properties: {
    cents: { type: "integer", description: "Minor units. The value to compute with." },
    amount: { type: "string", description: "The same value as a decimal string, e.g. `49.99`." },
    currency: { type: "string", description: "ISO 4217, e.g. `GBP`." },
  },
} as const;

const ADDRESS = {
  type: "object",
  required: ["line1", "line2", "city", "region", "postalCode", "country"],
  properties: {
    line1: nullable("string"),
    line2: nullable("string"),
    city: nullable("string"),
    region: nullable("string"),
    postalCode: nullable("string"),
    country: nullable("string", { description: "ISO 3166-1 alpha-2." }),
  },
} as const;

const SHOP = {
  type: "object",
  description: "The shop a key speaks for.",
  required: ["id", "object", "handle", "name", "currency", "timeZone", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "shop" },
    handle: { type: "string", description: "The storefront slug, e.g. `acme`." },
    name: { type: "string" },
    currency: { type: "string", description: "ISO 4217. Every price in this shop is in it." },
    timeZone: nullable("string", { description: "IANA name, e.g. `Europe/London`." }),
    createdAt: nullable("string", { format: "date-time" }),
  },
} as const;

const ORDER_ITEM = {
  type: "object",
  required: [
    "id", "productId", "variantId", "title", "variantLabel",
    "sku", "kind", "quantity", "unitPrice", "subtotal",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    productId: nullable("string", {
      format: "uuid",
      description: "Null once the product has been deleted; the line keeps its own title.",
    }),
    variantId: nullable("string", { format: "uuid" }),
    title: { type: "string", description: "The title as it was when it sold." },
    variantLabel: nullable("string"),
    sku: nullable("string"),
    kind: nullable("string"),
    quantity: { type: "integer" },
    unitPrice: { $ref: "#/components/schemas/Money" },
    subtotal: { $ref: "#/components/schemas/Money" },
  },
} as const;

const ORDER = {
  type: "object",
  description:
    "One order. Identical to the `data` of an `order.*` webhook, so a field map built against one works against the other.",
  required: [
    "id", "object", "status", "paymentStatus", "paymentMethod", "currency",
    "subtotal", "discount", "deliveryFee", "tax", "total", "refunded",
    "itemCount", "customer", "address", "delivery", "booking", "coupon",
    "affiliate", "note", "items", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "order" },
    status: { type: "string", enum: [...ORDER_STATUSES], description: "Where it is in fulfilment." },
    paymentStatus: {
      type: "string",
      enum: [...PAYMENT_STATUSES],
      description: "Where the money stands. Independent of `status`.",
    },
    paymentMethod: { type: "string" },
    currency: { type: "string" },
    subtotal: { $ref: "#/components/schemas/Money" },
    discount: { $ref: "#/components/schemas/Money" },
    deliveryFee: { $ref: "#/components/schemas/Money" },
    tax: { $ref: "#/components/schemas/Money" },
    total: { $ref: "#/components/schemas/Money" },
    refunded: { $ref: "#/components/schemas/Money" },
    itemCount: { type: "integer" },
    customer: {
      type: "object",
      required: ["clientId", "name", "email", "phone"],
      properties: {
        clientId: nullable("string", {
          format: "uuid",
          description: "The contact this order is attached to, if any.",
        }),
        name: nullable("string"),
        email: nullable("string"),
        phone: nullable("string"),
      },
    },
    address: { $ref: "#/components/schemas/Address" },
    delivery: {
      type: "object",
      required: [
        "method", "label", "pickupLocation",
        "trackingCarrier", "trackingNumber", "trackingUrl", "shippedAt",
      ],
      properties: {
        method: nullable("string"),
        label: nullable("string"),
        pickupLocation: nullable("string"),
        trackingCarrier: nullable("string"),
        trackingNumber: nullable("string"),
        trackingUrl: nullable("string"),
        shippedAt: nullable("string", { format: "date-time" }),
      },
    },
    booking: {
      type: ["object", "null"],
      description: "Null when there is no appointment, rather than an object of nulls.",
      required: ["scheduledFor", "serviceMode", "serviceLocation"],
      properties: {
        scheduledFor: nullable("string", { format: "date-time" }),
        serviceMode: nullable("string"),
        serviceLocation: nullable("string"),
      },
    },
    coupon: {
      type: ["object", "null"],
      required: ["code"],
      properties: { code: { type: "string" } },
    },
    affiliate: {
      type: ["object", "null"],
      required: ["code"],
      properties: { code: { type: "string" } },
    },
    note: nullable("string", { description: "What the buyer wrote at checkout." }),
    items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } },
    createdAt: nullable("string", { format: "date-time" }),
    updatedAt: nullable("string", { format: "date-time" }),
  },
} as const;

const PRODUCT_VARIANT = {
  type: "object",
  required: ["id", "sku", "options", "price", "stock", "isAvailable"],
  properties: {
    id: { type: "string", format: "uuid" },
    sku: nullable("string"),
    options: {
      type: ["object", "null"],
      description: "The choices this variant represents, e.g. `{ \"Size\": \"Large\" }`.",
      additionalProperties: { type: "string" },
    },
    price: {
      allOf: [{ $ref: "#/components/schemas/Money" }],
      description: "The variant's own price, or the product's where it has none.",
    },
    stock: nullable("integer", {
      description: "Null when the product does not track inventory. Not the same as zero.",
    }),
    isAvailable: { type: "boolean" },
  },
} as const;

const PRODUCT = {
  type: "object",
  required: [
    "id", "object", "title", "slug", "description", "kind", "tags",
    "price", "compareAt", "trackInventory", "stock", "inStock",
    "isPublished", "isFeatured", "booking", "event", "membership",
    "variants", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "product" },
    title: { type: "string" },
    slug: { type: "string" },
    description: nullable("string"),
    kind: { type: "string", enum: [...PRODUCT_KIND_VALUES] },
    tags: { type: "array", items: { type: "string" } },
    price: { $ref: "#/components/schemas/Money" },
    compareAt: {
      oneOf: [{ $ref: "#/components/schemas/Money" }, { type: "null" }],
      description: "The struck-through price, or null.",
    },
    trackInventory: { type: "boolean" },
    stock: nullable("integer", {
      description: "Null when inventory is not tracked — *not counted*, which is not sold out.",
    }),
    inStock: { type: "boolean" },
    isPublished: { type: "boolean" },
    isFeatured: { type: "boolean" },
    booking: {
      type: ["object", "null"],
      required: ["durationMinutes", "serviceMode", "leadHours"],
      properties: {
        durationMinutes: nullable("integer"),
        serviceMode: nullable("string"),
        leadHours: nullable("integer"),
      },
    },
    event: {
      type: ["object", "null"],
      required: ["startsAt", "endsAt"],
      properties: {
        startsAt: nullable("string", { format: "date-time" }),
        endsAt: nullable("string", { format: "date-time" }),
      },
    },
    membership: {
      type: ["object", "null"],
      required: ["interval", "intervalCount", "trialDays"],
      properties: {
        interval: nullable("string", {
          description: "`day`, `week`, `month` or `year`.",
        }),
        intervalCount: nullable("integer", {
          description: "How many intervals per charge — the `3` in every 3 months.",
        }),
        trialDays: nullable("integer"),
      },
    },
    variants: {
      type: "array",
      description: "Empty on the list endpoint; populated by `GET /products/{id}`.",
      items: { $ref: "#/components/schemas/ProductVariant" },
    },
    createdAt: nullable("string", { format: "date-time" }),
    updatedAt: nullable("string", { format: "date-time" }),
  },
} as const;

const CONTACT = {
  type: "object",
  description:
    "A person on a shop's list. The seller's private `notes` column is deliberately absent.",
  required: [
    "id", "object", "name", "email", "phone", "tags",
    "source", "marketingConsentAt", "address", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "contact" },
    name: { type: "string" },
    email: nullable("string"),
    phone: nullable("string"),
    tags: { type: "array", items: { type: "string" } },
    source: nullable("string", { description: "How they arrived, e.g. `api`, `order`, `form`." }),
    marketingConsentAt: nullable("string", {
      format: "date-time",
      description:
        "When they opted in to marketing email, or null if they never did. A null here means you may not add them to a mailing list.",
    }),
    address: { $ref: "#/components/schemas/Address" },
    createdAt: nullable("string", { format: "date-time" }),
    updatedAt: nullable("string", { format: "date-time" }),
  },
} as const;

const SUBSCRIPTION = {
  type: "object",
  description:
    "A membership. Identical to the `data` of every `subscription.*` webhook, so a field map built against one works against the other.",
  required: [
    "id", "object", "status", "productId", "clientId", "price", "currency",
    "interval", "intervalCount", "billingMode", "paymentMethod",
    "currentPeriodEnd", "cancelAtPeriodEnd", "canceledAt", "trialEndsAt",
    "startedAt", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "subscription" },
    status: { type: "string", enum: [...SUBSCRIPTION_STATUSES] },
    productId: nullable("string", {
      format: "uuid",
      description: "Null once the product has been deleted; the membership survives it.",
    }),
    clientId: nullable("string", { format: "uuid" }),
    price: { $ref: "#/components/schemas/Money" },
    currency: { type: "string", description: "ISO 4217." },
    interval: { type: "string", description: "`day`, `week`, `month` or `year`." },
    intervalCount: {
      type: "integer",
      description: "How many intervals per charge — the `3` in every 3 months.",
    },
    billingMode: {
      type: "string",
      description:
        "`stripe` or `manual`. A manual membership renews by an order a human settles; nothing will ever arrive from Stripe about it.",
    },
    paymentMethod: nullable("string", {
      description: "The rail a manual member pays on. Null on a card subscription.",
    }),
    currentPeriodEnd: nullable("string", {
      format: "date-time",
      description: "Paid up to here. The field to revoke access on.",
    }),
    cancelAtPeriodEnd: {
      type: "boolean",
      description:
        "They asked to stop but have paid through `currentPeriodEnd` and keep access until it.",
    },
    canceledAt: nullable("string", { format: "date-time" }),
    trialEndsAt: nullable("string", { format: "date-time" }),
    startedAt: nullable("string", { format: "date-time" }),
    createdAt: nullable("string", { format: "date-time" }),
    updatedAt: nullable("string", { format: "date-time" }),
  },
} as const;

const DISPUTE = {
  type: "object",
  description:
    "A chargeback against one of this shop's sales. Identical to the `data` of `dispute.opened` and `dispute.closed`. Never a platform dispute — a seller charging back their own Sailo subscription is not something this API describes.",
  required: [
    "id", "object", "orderId", "status", "caseType", "reason",
    "networkReasonCode", "network", "amount", "fee", "deducted", "currency",
    "dueBy", "evidenceSubmittedAt", "submissionCount", "completenessBp",
    "fundsWithdrawnAt", "fundsReinstatedAt", "openedAt", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "dispute" },
    orderId: nullable("string", { format: "uuid" }),
    status: { type: "string", enum: [...DISPUTE_STATUSES] },
    caseType: nullable("string", {
      enum: [...DISPUTE_CASE_TYPES, null],
      description:
        "An `inquiry` is the issuer asking a question and has cost nothing yet; a `chargeback` has already taken the money.",
    }),
    reason: nullable("string", {
      description: "Stripe's reason string: `fraudulent`, `product_not_received`…",
    }),
    networkReasonCode: nullable("string", {
      description: "The card network's own code — `10.4`, `13.1`.",
    }),
    network: nullable("string"),
    amount: { $ref: "#/components/schemas/Money" },
    fee: {
      allOf: [{ $ref: "#/components/schemas/Money" }],
      description: "Stripe's dispute fee, which is why a £42 chargeback costs £57.",
    },
    deducted: {
      allOf: [{ $ref: "#/components/schemas/Money" }],
      description: "Amount plus fee — what actually left the seller's balance.",
    },
    currency: { type: "string", description: "ISO 4217." },
    dueBy: nullable("string", {
      format: "date-time",
      description: "The response deadline. Null on a case that no longer needs one.",
    }),
    evidenceSubmittedAt: nullable("string", { format: "date-time" }),
    submissionCount: { type: "integer" },
    completenessBp: {
      type: "integer",
      description:
        "How complete the submission was over its required fields, in basis points. The evidence itself is never returned.",
    },
    fundsWithdrawnAt: nullable("string", { format: "date-time" }),
    fundsReinstatedAt: nullable("string", { format: "date-time" }),
    openedAt: nullable("string", { format: "date-time" }),
    createdAt: nullable("string", { format: "date-time" }),
    updatedAt: nullable("string", { format: "date-time" }),
  },
} as const;

const BOOKING = {
  type: "object",
  description:
    "One appointment. There is no status: a slot is given back by removing the claim, so a booking that is still here is one that still stands.",
  required: [
    "id", "object", "orderId", "productId", "productTitle", "staffId",
    "staffName", "startsAt", "endsAt", "seats", "isExclusive", "createdAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "booking" },
    orderId: { type: "string", format: "uuid" },
    productId: { type: "string", format: "uuid" },
    productTitle: nullable("string", {
      description: "The service as it is titled now, not as it was when booked.",
    }),
    staffId: nullable("string", {
      format: "uuid",
      description: "Null on a shop that books the shop rather than a named person.",
    }),
    staffName: nullable("string"),
    startsAt: nullable("string", { format: "date-time" }),
    endsAt: nullable("string", { format: "date-time" }),
    seats: {
      type: "integer",
      description: "How many places this claim takes. Always 1 on an exclusive booking.",
    },
    isExclusive: {
      type: "boolean",
      description:
        "True when the claim holds the whole slot. False means a seat in a class, where several bookings share one window without conflicting.",
    },
    createdAt: nullable("string", { format: "date-time" }),
  },
} as const;

const STAFF = {
  type: "object",
  description:
    "Somebody a buyer can book. Not a login and not a team member — a name on a roster, with no account and no access to anything.",
  required: [
    "id", "object", "name", "email", "avatarUrl", "timeZone",
    "isActive", "position", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "staff" },
    name: { type: "string" },
    email: nullable("string"),
    avatarUrl: nullable("string"),
    timeZone: nullable("string", {
      description: "IANA name. Null means the shop's own zone, not UTC.",
    }),
    isActive: {
      type: "boolean",
      description:
        "Whether they can be booked now. An inactive person can still be the `staffId` on an appointment already in the diary.",
    },
    position: { type: "integer", description: "The seller's own ordering of the roster." },
    createdAt: nullable("string", { format: "date-time" }),
    updatedAt: nullable("string", { format: "date-time" }),
  },
} as const;

const LIST = {
  type: "object",
  description:
    "A named list a contact can be on. The two counts answer different questions and must not be added together.",
  required: [
    "id", "object", "name", "description", "doubleOptIn",
    "subscribedCount", "pendingCount", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "list" },
    name: { type: "string" },
    description: nullable("string"),
    doubleOptIn: {
      type: "boolean",
      description:
        "Whether joining needs a click in the member's own inbox. On a list that asks for it, a join lands as `pending` and no API call can produce a subscriber.",
    },
    subscribedCount: {
      type: "integer",
      description: "How many people a send would actually reach.",
    },
    pendingCount: {
      type: "integer",
      description:
        "Added but not yet confirmed. On the list, and **not** recipients — counting them as audience overstates every list by exactly the people who never clicked.",
    },
    createdAt: nullable("string", { format: "date-time" }),
    updatedAt: nullable("string", { format: "date-time" }),
  },
} as const;

const FLOW = {
  type: "object",
  description:
    "An automation: a sequence a seller built once that runs itself. The node bodies are deliberately summarised rather than published — that shape is the builder's and the runner's, and is ours to change.",
  required: [
    "id", "object", "name", "kind", "status", "trigger", "entryPolicy",
    "steps", "stepCount", "runs", "activatedAt", "createdAt", "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "flow" },
    name: { type: "string" },
    kind: { type: "string", enum: [...AUTOMATION_KINDS] },
    status: {
      type: "string",
      enum: [...AUTOMATION_STATUSES],
      description: "Only `active` enrols anybody. A paused flow keeps its waiting runs.",
    },
    trigger: {
      type: ["object", "null"],
      description: "What starts it. Null on a draft nobody has finished.",
      required: ["type", "config"],
      properties: {
        type: { type: "string", description: "e.g. `list.joined`, `product.purchased`." },
        config: {
          type: "object",
          additionalProperties: true,
          description: "The trigger's qualifier — which list, which product.",
        },
      },
    },
    entryPolicy: {
      type: "string",
      description: "`once` or `repeat` — whether somebody may walk this flow again.",
    },
    steps: {
      type: "array",
      description: "The nodes in the order the runner walks them.",
      items: {
        type: "object",
        required: ["id", "kind"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: [...NODE_KINDS] },
        },
      },
    },
    stepCount: { type: "integer" },
    runs: {
      type: ["object", "null"],
      description:
        "Null on the list endpoint, which does not pay for the tally. Populated by `GET /flows/{id}`.",
      required: ["total", "live", "completed", "failed", "cancelled"],
      properties: {
        total: { type: "integer", description: "Everybody who has ever entered." },
        live: {
          type: "integer",
          description: "Queued plus waiting — people still inside the flow.",
        },
        completed: { type: "integer" },
        failed: { type: "integer" },
        cancelled: { type: "integer" },
      },
    },
    activatedAt: nullable("string", { format: "date-time" }),
    createdAt: nullable("string", { format: "date-time" }),
    updatedAt: nullable("string", { format: "date-time" }),
  },
} as const;

const FLOW_RUN = {
  type: "object",
  description: "One person moving through one flow.",
  required: [
    "id", "object", "flowId", "contactId", "email", "status", "currentStep",
    "wakeAt", "attempt", "enteredAt", "finishedAt", "lastError",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    object: { type: "string", const: "flow_run" },
    flowId: { type: "string", format: "uuid" },
    contactId: nullable("string", {
      format: "uuid",
      description: "Null when the flow was entered by an address with no contact record.",
    }),
    email: { type: "string", description: "The address the run is keyed on." },
    status: { type: "string", enum: [...RUN_STATUSES] },
    currentStep: nullable("string", {
      description: "The node id they are sitting on, from the flow's `steps`. Null once over.",
    }),
    wakeAt: nullable("string", {
      format: "date-time",
      description: "When the runner next looks at them. Null when nothing is pending.",
    }),
    attempt: { type: "integer", description: "Retries of the current step. Six is the ceiling." },
    enteredAt: nullable("string", { format: "date-time" }),
    finishedAt: nullable("string", { format: "date-time" }),
    lastError: nullable("string", {
      description:
        "Why a failed run stopped, as a sentence. Never a stack, a driver message or a third party's response body.",
    }),
  },
} as const;

const ERROR = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: {
          type: "string",
          enum: Object.keys(API_ERROR_CODES),
          description: "Stable. Branch on this, never on the message.",
        },
        message: {
          type: "string",
          description: "A sentence for a human. May be reworded at any time.",
        },
      },
    },
  },
} as const;

const SCHEMAS: Record<string, unknown> = {
  Money: MONEY,
  Address: ADDRESS,
  Shop: SHOP,
  Order: ORDER,
  OrderItem: ORDER_ITEM,
  Product: PRODUCT,
  ProductVariant: PRODUCT_VARIANT,
  Contact: CONTACT,
  Subscription: SUBSCRIPTION,
  Dispute: DISPUTE,
  Booking: BOOKING,
  Staff: STAFF,
  List: LIST,
  Flow: FLOW,
  FlowRun: FLOW_RUN,
  Error: ERROR,
};

/* -------------------------------------------------------------------------- */
/*  Assembly                                                                   */
/* -------------------------------------------------------------------------- */

const ref = (name: ResourceName) => ({ $ref: `#/components/schemas/${name}` });

/** The `sailo-version` header every response carries, on every response. */
const VERSION_HEADER = {
  "sailo-version": {
    schema: { type: "string", example: API_VERSION },
    description: "The API contract this response was built against.",
  },
};

function successBody(endpoint: Endpoint): Record<string, unknown> {
  const resource = endpoint.resultExtra
    ? {
        allOf: [
          ref(endpoint.result.resource),
          {
            type: "object",
            required: endpoint.resultExtra.filter((f) => f.required).map((f) => f.name),
            properties: Object.fromEntries(
              endpoint.resultExtra.map((f) => [
                f.name,
                { ...f.schema, description: f.description },
              ]),
            ),
          },
        ],
      }
    : ref(endpoint.result.resource);

  if (endpoint.result.shape === "one") {
    return {
      type: "object",
      required: ["data"],
      properties: { data: resource },
    };
  }

  return {
    type: "object",
    required: ["data", "has_more", "next_cursor"],
    properties: {
      data: { type: "array", items: resource },
      has_more: {
        type: "boolean",
        description:
          "Whether another page exists. Loop on this rather than on `next_cursor`, which is null on the last full page of a keyset scan.",
      },
      next_cursor: nullable("string", { description: "Pass as `?cursor=` to get the next page." }),
    },
  };
}

function requestBody(endpoint: Endpoint): Record<string, unknown> | undefined {
  if (!endpoint.body) return undefined;

  return {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: endpoint.body.fields.filter((f) => f.required).map((f) => f.name),
          properties: Object.fromEntries(
            endpoint.body.fields.map((f) => [f.name, { ...f.schema, description: f.description }]),
          ),
          additionalProperties: false,
        },
        example: JSON.parse(endpoint.body.example) as unknown,
      },
    },
  };
}

/**
 * One response object per HTTP status, with every reason that status can occur
 * folded into its description.
 *
 * Grouped rather than listed one-per-reason because OpenAPI keys responses on
 * the status code — two 400s would silently overwrite each other, and the one
 * that survived would describe only half of when it happens.
 */
function errorResponses(endpoint: Endpoint): Record<string, unknown> {
  const byStatus = new Map<number, string[]>();

  for (const error of endpoint.errors) {
    const status = API_ERROR_CODES[error.code];
    const reasons = byStatus.get(status) ?? [];
    const line = `\`${error.code}\` — ${error.when}`;
    if (!reasons.includes(line)) reasons.push(line);
    byStatus.set(status, reasons);
  }

  return Object.fromEntries(
    [...byStatus.entries()]
      .toSorted(([a], [b]) => a - b)
      .map(([status, reasons]) => [
        String(status),
        {
          description: reasons.join("\n\n"),
          headers: VERSION_HEADER,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      ]),
  );
}

function operation(endpoint: Endpoint): Record<string, unknown> {
  const body = requestBody(endpoint);

  return {
    operationId: endpoint.id,
    summary: endpoint.summary,
    description: endpoint.description,
    tags: [endpoint.path.split("/")[1] ?? "v1"],
    ...(endpoint.scope === "write" ? { "x-sailo-scope": "write" } : { "x-sailo-scope": "read" }),
    parameters: endpoint.params.map((param) => ({
      name: param.name,
      in: param.in,
      required: param.required,
      description: param.description,
      schema: param.schema,
    })),
    ...(body ? { requestBody: body } : {}),
    responses: {
      "200": {
        description: endpoint.summary,
        headers: VERSION_HEADER,
        content: { "application/json": { schema: successBody(endpoint) } },
      },
      ...errorResponses(endpoint),
    },
  };
}

/**
 * The whole document.
 *
 * Built on each call rather than frozen at module load so that `baseUrl`, which
 * differs between a preview deployment and production, is the one actually
 * serving the request.
 */
export function openApiDocument(baseUrl: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const endpoint of ENDPOINTS) {
    const path = `/api/v1${endpoint.path}`;
    paths[path] ??= {};
    paths[path][endpoint.method.toLowerCase()] = operation(endpoint);
  }

  return {
    openapi: "3.1.1",
    info: {
      title: "Sailo API",
      version: API_VERSION,
      summary: "Read a Sailo shop's orders, products and contacts, and add to its list.",
      description: [
        "One key opens the REST API, the MCP server and the webhook signing secret.",
        "",
        "Every response is `{ \"data\": … }`; every failure is `{ \"error\": { \"code\", \"message\" } }` with a matching status. Branch on `code` — it is stable and only ever added to — never on `message`.",
        "",
        `Lists are keyset-paged: pass \`next_cursor\` as \`?cursor=\` and stop when \`has_more\` is false. At most ${MAX_LIMIT} rows a page.`,
        "",
        "There are no CORS headers, deliberately: a key a browser can send is a key in somebody's bundle.",
      ].join("\n"),
      license: { name: "Proprietary", url: `${baseUrl}/terms` },
      /*
       * `baseUrl` is the origin that answered the request, and the terms live
       * on it. The documentation does not: it is its own deployment on its own
       * host, so this is the one URL in the document that must not be built
       * from the server's address.
       */
      contact: { name: "Sailo", url: docsUrl("/api") },
    },
    servers: [{ url: baseUrl, description: "Production" }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "shop", description: "Which shop a key speaks for." },
      { name: "orders", description: "Sales, and what was in them." },
      { name: "products", description: "The catalogue." },
      { name: "contacts", description: "The shop's list, and its consent state." },
      { name: "lists", description: "Named lists, and who is actually on them." },
      { name: "subscriptions", description: "Memberships, and whether they still run." },
      { name: "disputes", description: "Chargebacks against this shop's sales." },
      { name: "bookings", description: "The diary — appointments a shop owes." },
      { name: "staff", description: "The bookable roster. Not logins." },
      { name: "flows", description: "Automations, and who is walking them." },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "An API key from Settings → Integrations, sent as `Authorization: Bearer sailo_sk_…`. Never in a query string — a token in a URL is written to every access log it passes through.",
        },
      },
      schemas: SCHEMAS,
    },
  };
}
