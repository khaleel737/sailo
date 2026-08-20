import "server-only";
import type { ApiCaller } from "../rest/auth";
import type { ApiScope } from "../rest/keys";
import {
  getBooking,
  getContact,
  getContactLists,
  getDispute,
  getList,
  getOrder,
  getProduct,
  getShop,
  getStaff,
  getSubscription,
  listBookings,
  listContacts,
  listDisputes,
  listLists,
  listOrders,
  listProducts,
  listStaff,
  listSubscriptions,
  tagContact,
  updateContactLists,
  upsertContact,
  type Handled,
  type Page,
} from "../rest/handlers";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../rest/respond";
import { SUBSCRIPTION_STATUSES } from "@sailo/core/subscription-status";
import { DISPUTE_STATUSES } from "@sailo/core/disputes";

/**
 * What a model can do with a Sailo shop.
 *
 * **Every tool is a thin wrapper over the same handler the REST route calls.**
 * Not a reimplementation, not a "simplified" version — the same function, with
 * the same `shopId` in the same WHERE. That is deliberate and it is the most
 * important property of this file: two implementations of "list this shop's
 * orders" would be two ownership checks, and the one that drifted would be the
 * way into somebody else's shop.
 *
 * Descriptions are written for a model, not for a developer. They say what the
 * tool is *for* and what its answer means, because that is what a model uses
 * to decide whether to call it — a description that only restates the name
 * ("lists orders") tells it nothing it did not already know from the name.
 */

type ToolResult = Handled<unknown> & { page?: Page<unknown> };

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The scope a key needs. Read tools are listed for every key. */
  scope: ApiScope;
  run: (caller: ApiCaller, args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
};

/* -------------------------------------------------------------------------- */
/*  Shared schema fragments                                                    */
/* -------------------------------------------------------------------------- */

const limitProperty = {
  type: "integer",
  minimum: 1,
  maximum: MAX_LIMIT,
  description: `How many to return. Defaults to ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.`,
};

const cursorProperty = {
  type: "string",
  description:
    "Pass `next_cursor` from a previous call to get the following page. Omit for the first page.",
};

/** `{ limit, cursor }` read out of loosely-typed tool arguments. */
function paging(args: Record<string, unknown>) {
  const raw = Number(args.limit);
  return {
    limit: Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), MAX_LIMIT) : DEFAULT_LIMIT,
    cursor: typeof args.cursor === "string" ? args.cursor : null,
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/* -------------------------------------------------------------------------- */
/*  The tools                                                                  */
/* -------------------------------------------------------------------------- */

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "get_shop",
    title: "Get shop",
    description:
      "The shop this key belongs to: its handle, display name, currency and time zone. " +
      "Call this first when you need to know which currency amounts are in, or which " +
      "time zone dates should be read in.",
    scope: "read",
    inputSchema: { type: "object", additionalProperties: false },
    run: (caller) => getShop(caller),
  },

  {
    name: "list_orders",
    title: "List orders",
    description:
      "Orders, newest first. Use `email` to find everything one customer has bought, " +
      "`status` for where an order is in fulfilment (new, confirmed, shipped, completed, " +
      "cancelled, refunded), and `payment_status` for whether the money arrived (unpaid, " +
      "paid, refunded). An order can be paid but not yet shipped, so the two are separate " +
      "questions and answering one does not answer the other.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Fulfilment stage, e.g. `shipped`." },
        payment_status: { type: "string", description: "Money state, e.g. `paid`." },
        email: { type: "string", description: "Exact customer email, case-insensitive." },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      additionalProperties: false,
    },
    run: (caller, args) =>
      listOrders(caller, {
        ...paging(args),
        status: str(args.status),
        paymentStatus: str(args.payment_status),
        email: str(args.email),
      }),
  },

  {
    name: "get_order",
    title: "Get order",
    description:
      "One order in full, including every line item, the delivery address and any " +
      "tracking details. Use it after `list_orders` when you need the items rather than " +
      "the summary.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The order id." } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) => getOrder(caller, String(args.id ?? "")),
  },

  {
    name: "list_products",
    title: "List products",
    description:
      "The shop's catalogue, newest first. `published` filters to what buyers can " +
      "currently see; omit it to include drafts. `stock` is null on products that do not " +
      "track inventory — that means 'not counted', which is not the same as sold out.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "One of `physical`, `digital`, `service`, `event`.",
        },
        published: { type: "boolean", description: "Only published, or only drafts." },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      additionalProperties: false,
    },
    run: (caller, args) =>
      listProducts(caller, {
        ...paging(args),
        kind: str(args.kind),
        published: typeof args.published === "boolean" ? args.published : null,
      }),
  },

  {
    name: "get_product",
    title: "Get product",
    description:
      "One product in full, including its variants and their individual stock. Use it after " +
      "`list_products`, which leaves variants out — so a question about sizes, options or " +
      "per-variant stock needs this rather than the list. A variant with no price of its own " +
      "inherits the product's, so `price` is always populated.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The product id." } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) => getProduct(caller, String(args.id ?? "")),
  },

  {
    name: "list_contacts",
    title: "List contacts",
    description:
      "People on the shop's list. Set `consented` to true for only those who opted in to " +
      "marketing email — everyone else is a customer who never agreed to be emailed, and " +
      "must not be added to a mailing list or newsletter tool. `marketingConsentAt` on " +
      "each record is when they agreed, or null if they never did.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Only contacts carrying this tag." },
        email: { type: "string", description: "Exact email, case-insensitive." },
        consented: {
          type: "boolean",
          description: "True for only those who opted in to marketing email.",
        },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      additionalProperties: false,
    },
    run: (caller, args) =>
      listContacts(caller, {
        ...paging(args),
        tag: str(args.tag),
        email: str(args.email),
        consented: args.consented === true ? true : null,
      }),
  },

  {
    name: "get_contact",
    title: "Get contact",
    description:
      "One person on the shop's list, with their tags and consent state. " +
      "`marketingConsentAt` is when they opted in to marketing email, or null if they never " +
      "did — and null means no, not unknown. Use `get_contact_lists` for which lists they are " +
      "on; this does not carry them.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The contact id." } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) => getContact(caller, String(args.id ?? "")),
  },

  {
    name: "create_contact",
    title: "Create or update a contact",
    description:
      "Adds somebody to the shop's list, or updates and merges tags onto them if they are " +
      "already on it. This CANNOT grant marketing consent — a new contact is always created " +
      "without it, whatever you pass. To get consent, set `send_opt_in` to true: that emails " +
      "the person a confirmation link, and consent is recorded only when they click it. " +
      "Never tell the seller a contact is subscribed on the strength of this call alone.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Merged with any tags they already have; never replaces them.",
        },
        send_opt_in: {
          type: "boolean",
          description:
            "Email this person a double opt-in confirmation link. Requires an email address.",
        },
      },
      additionalProperties: false,
    },
    run: (caller, args) =>
      upsertContact(caller, {
        name: args.name,
        email: args.email,
        phone: args.phone,
        tags: args.tags,
        sendOptIn: args.send_opt_in,
      }),
  },

  {
    name: "tag_contact",
    title: "Tag a contact",
    description:
      "Adds and removes tags on one contact. Tags are how a seller segments their list, so " +
      "this is what changes who a future broadcast reaches. Omitted tags are left alone — " +
      "there is no way to replace the whole set, on purpose.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The contact id." },
        add: {
          type: "array",
          items: { type: "string" },
          description: "Tags to put on them. Ones they already carry are left alone.",
        },
        remove: {
          type: "array",
          items: { type: "string" },
          description: "Tags to take off. Ones they do not carry are not an error.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) =>
      tagContact(caller, String(args.id ?? ""), { add: args.add, remove: args.remove }),
  },

  {
    name: "list_lists",
    title: "List contact lists",
    description:
      "The shop's named lists. A tag says what somebody is; a list is what they get sent, so " +
      "this is what a broadcast is actually addressed to. Read the two counts separately and " +
      "never add them together: `subscribedCount` is how many people a send would really " +
      "reach, and `pendingCount` is people who were added to a double opt-in list and have " +
      "not confirmed — they are on the list and they are not recipients. If a seller asks how " +
      "big a list is, the honest answer is the subscribed count.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { limit: limitProperty, cursor: cursorProperty },
      additionalProperties: false,
    },
    run: (caller, args) => listLists(caller, paging(args)),
  },

  {
    name: "get_list",
    title: "Get a contact list",
    description:
      "One list, with its audience counts and whether it asks for double opt-in. Check " +
      "`doubleOptIn` before promising a seller that adding somebody will subscribe them: on a " +
      "list that asks for confirmation, nothing you can do will produce a subscriber.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The list id." } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) => getList(caller, String(args.id ?? "")),
  },

  {
    name: "get_contact_lists",
    title: "Which lists a contact is on",
    description:
      "The lists one contact belongs to, and the state of each membership. Read `status` " +
      "before saying anything about it: `subscribed` will receive the next broadcast, " +
      "`pending` was added to a double opt-in list and has not confirmed, and `removed` is " +
      "somebody who left. Only `subscribed` is a recipient.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The contact id." } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) => getContactLists(caller, String(args.id ?? "")),
  },

  {
    name: "update_contact_lists",
    title: "Put a contact on lists, or take them off",
    description:
      "Joins and leaves lists for one contact. This CANNOT make somebody a subscriber on a " +
      "double opt-in list: the membership lands as `pending` and only their own click on the " +
      "confirmation email turns it into `subscribed`. The reply tells you the state each " +
      "membership actually settled in — read it, and never tell the seller somebody is " +
      "subscribed when it says pending. Leaving marks the membership removed rather than " +
      "deleting it, and does not unsubscribe them from anything else.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The contact id." },
        join: {
          type: "array",
          items: { type: "string" },
          description: "List ids to put them on.",
        },
        leave: {
          type: "array",
          items: { type: "string" },
          description: "List ids to take them off.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) =>
      updateContactLists(caller, String(args.id ?? ""), {
        join: args.join,
        leave: args.leave,
      }),
  },

  {
    name: "list_subscriptions",
    title: "List memberships",
    description:
      "The shop's memberships, newest first. `billingMode` decides what renewal even means: a " +
      "`stripe` membership renews on a card, and a `manual` one renews by an order somebody " +
      "settles by hand, so nothing will ever arrive from Stripe about it. To answer whether " +
      "somebody still has access, read `currentPeriodEnd` rather than the status — a member " +
      "who cancelled has paid to the end of the period and keeps what they bought until then, " +
      `and \`past_due\` is a card that failed this morning, not an ended membership. Statuses: ${SUBSCRIPTION_STATUSES.join(", ")}.`,
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "e.g. `active`, `past_due`, `canceled`." },
        product_id: { type: "string", description: "Only memberships to this product." },
        contact_id: { type: "string", description: "Only memberships held by this contact." },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      additionalProperties: false,
    },
    run: (caller, args) =>
      listSubscriptions(caller, {
        ...paging(args),
        status: str(args.status),
        productId: str(args.product_id),
        contactId: str(args.contact_id),
      }),
  },

  {
    name: "get_subscription",
    title: "Get a membership",
    description:
      "One membership in full. The same object every `subscription.*` webhook carries. " +
      "`cancelAtPeriodEnd` true means they asked to stop and have not lost access yet.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The subscription id." } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) => getSubscription(caller, String(args.id ?? "")),
  },

  {
    name: "list_disputes",
    title: "List chargebacks",
    description:
      "Chargebacks buyers have raised against this shop's sales, newest first. These are " +
      "time-critical: `dueBy` is the deadline to respond and it is usually about twenty days " +
      "from when the case opened, so surface the ones in `needs_response` first. `caseType` " +
      "says whether it has cost anything yet — an `inquiry` is the bank asking a question and " +
      "no money has moved, a `chargeback` has already taken `deducted` out of the seller's " +
      `balance. A chargeback is not a refund and must never be described as one. Statuses: ${DISPUTE_STATUSES.join(", ")}.`,
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "e.g. `needs_response`, `won`, `lost`." },
        order_id: { type: "string", description: "Only disputes against this order." },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      additionalProperties: false,
    },
    run: (caller, args) =>
      listDisputes(caller, {
        ...paging(args),
        status: str(args.status),
        orderId: str(args.order_id),
      }),
  },

  {
    name: "get_dispute",
    title: "Get a chargeback",
    description:
      "One chargeback in full. The evidence bundle itself is never returned — `completenessBp` " +
      "says how complete the submission was without shipping it. You cannot respond to a " +
      "dispute through this API; that happens in the seller's admin, where the deadline and " +
      "the consequences are in front of them.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The dispute id." } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) => getDispute(caller, String(args.id ?? "")),
  },

  {
    name: "list_bookings",
    title: "List appointments",
    description:
      "Appointments in the shop's diary, ordered by when they were booked rather than when " +
      "they happen — so use `from` and `to` to ask about a date range and sort the answer " +
      "yourself if you need it chronologically. Both are ISO 8601 and the window is on when an " +
      "appointment starts. `isExclusive` false means a seat in a class, where several bookings " +
      "share one time slot without clashing; true means the whole slot is taken. Treating " +
      "every booking as exclusive will report clashes that are not real. There is no status: a " +
      "cancelled appointment stops being returned at all.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "Only appointments for this service." },
        staff_id: { type: "string", description: "Only appointments taken by this person." },
        from: {
          type: "string",
          description: "ISO 8601. Appointments starting at or after this instant.",
        },
        to: {
          type: "string",
          description: "ISO 8601, exclusive. Appointments starting before this instant.",
        },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      additionalProperties: false,
    },
    run: (caller, args) =>
      listBookings(caller, {
        ...paging(args),
        productId: str(args.product_id),
        staffId: str(args.staff_id),
        from: str(args.from),
        to: str(args.to),
      }),
  },

  {
    name: "get_booking",
    title: "Get an appointment",
    description:
      "One appointment, with the service it is for and who is taking it. `staffId` is null on a " +
      "shop that books the shop rather than a named person.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The booking id." } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) => getBooking(caller, String(args.id ?? "")),
  },

  {
    name: "list_staff",
    title: "List the bookable roster",
    description:
      "The people a buyer can pick when booking. These are NOT user accounts, NOT logins and " +
      "NOT the seller's colleagues — a staff resource is a name on a roster that can be " +
      "attached to an appointment, and it grants nobody access to anything. Set `active` to " +
      "true for who can be booked now; somebody stood down keeps their name on appointments " +
      "already in the diary, which is why they are deactivated rather than deleted.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        active: { type: "boolean", description: "Only bookable, or only stood down." },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      additionalProperties: false,
    },
    run: (caller, args) =>
      listStaff(caller, {
        ...paging(args),
        active: typeof args.active === "boolean" ? args.active : null,
      }),
  },

  {
    name: "get_staff",
    title: "Get somebody on the roster",
    description:
      "One bookable person. `timeZone` null means the shop's own zone rather than UTC, which " +
      "is the zone to read their appointment times in.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The staff member id." } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (caller, args) => getStaff(caller, String(args.id ?? "")),
  },
] as const;

/**
 * The tools this particular key may use.
 *
 * The specification allows the listed set to vary by the authorization on the
 * request — credentials are per-request input, not connection state — and this
 * uses that: a read-only key never sees the write tools at all. Hiding them is
 * better than refusing them at call time, because a model that cannot see a
 * tool does not spend a turn discovering it may not use it, and does not
 * promise the user something it then cannot do.
 */
export function toolsFor(caller: ApiCaller): McpTool[] {
  return MCP_TOOLS.filter((tool) => caller.scopes.includes(tool.scope));
}

export function findTool(caller: ApiCaller, name: string): McpTool | null {
  return toolsFor(caller).find((tool) => tool.name === name) ?? null;
}

/**
 * A handler's answer, in the shape `tools/call` returns.
 *
 * `structuredContent` carries the data and the text block carries the same
 * JSON serialised — which the spec recommends for exactly the reason it looks
 * redundant: a client that does not read structured content still shows the
 * model something useful, rather than an empty result.
 *
 * A failure comes back as `isError: true` with the message rather than as a
 * JSON-RPC error, because those are two different things to a model. A
 * protocol error says "this call was malformed" and the model can do nothing
 * with it; a tool execution error says "no contact with that id" and the model
 * can go and find the right one. Refusals here are the second kind.
 */
export function toolResponse(result: ToolResult): Record<string, unknown> {
  if (!result.ok) {
    return {
      content: [{ type: "text", text: result.failure.message }],
      isError: true,
    };
  }

  const payload =
    result.page !== undefined
      ? {
          data: result.data,
          has_more: result.page.hasMore,
          next_cursor: result.page.nextCursor,
        }
      : result.data;

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: false,
  };
}
