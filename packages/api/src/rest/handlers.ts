import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  automationRuns,
  automations,
  bookingClaims,
  clients,
  contactListMembers,
  contactLists,
  disputes,
  orderItems,
  orders,
  productVariants,
  products,
  staffResources,
  subscriptions,
  type Order,
} from "@sailo/db/schema";
import { MAX_TAGS, normalizeTag, normalizeTags } from "@sailo/core/tags";
import { normalizePhone } from "@sailo/core/phone";
import { isUuid } from "@sailo/core/uuid";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import { MAX_EMAIL_LENGTH, confirmUrl, normalizeEmail, normalizeName, subscribeToken } from "@sailo/marketing/broadcasts/server";
import { joinList, listsForClient } from "@sailo/marketing/contacts/server";
import { sendSubscribeConfirmation } from "@sailo/email/lifecycle";
import { getDictionary, interpolate } from "@sailo/i18n";
import { rateLimit } from "@sailo/rate-limit";
import type { ApiCaller } from "./auth";
import {
  bookingResource,
  flowResource,
  flowRunResource,
  contactListResource,
  contactResource,
  disputeResource,
  iso,
  orderResource,
  productResource,
  shopResource,
  staffResource,
  subscriptionResource,
} from "@sailo/core/resources";
import {
  decodeCursor,
  encodeCursor,
  type ApiFailure,
  type Cursor,
} from "./respond";

/**
 * Everything `/api/v1` and `/api/mcp` can actually do, as plain functions.
 *
 * **Neither transport contains any logic.** A REST route reads the query
 * string and calls one of these; an MCP tool reads its arguments and calls the
 * same one. That is what makes the two surfaces impossible to drift apart —
 * the alternative, which is the obvious thing to write, is a second
 * implementation of every read with its own subtly different ownership check,
 * and the one that gets it wrong is the way into somebody else's shop.
 *
 * Every function takes an `ApiCaller` and puts `shopId` in the WHERE. Not one
 * of them takes a shop id as an argument, so there is no call site that can
 * pass the wrong one.
 */

export type Handled<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

const notFound = (what: string): { ok: false; failure: ApiFailure } => ({
  ok: false,
  failure: { code: "not_found", message: `No such ${what}.` },
});

const invalid = (message: string): { ok: false; failure: ApiFailure } => ({
  ok: false,
  failure: { code: "invalid_request", message },
});

/* -------------------------------------------------------------------------- */
/*  Paging                                                                     */
/* -------------------------------------------------------------------------- */

export type ListOptions = {
  limit: number;
  cursor: string | null;
};

export type Page<T> = { items: T[]; hasMore: boolean; nextCursor: string | null };

/**
 * Keyset paging over `(created_at, id)`, newest first.
 *
 * The row-value comparison is one expression rather than
 * `created_at < ? OR (created_at = ? AND id < ?)`, because Postgres can use a
 * composite index for the first and cannot for the second — and because the
 * long form is where an off-by-one lives that silently drops a row whenever
 * two share a timestamp, which on a busy shop is every import.
 *
 * The casts are load-bearing. Both values arrive as text parameters, and
 * comparing a `uuid` column to text is an error rather than a coercion.
 */
function keysetWhere(
  table: { createdAt: unknown; id: unknown },
  cursor: Cursor,
) {
  return sql`(${table.createdAt}, ${table.id}) < (${cursor.createdAt.toISOString()}::timestamp, ${cursor.id}::uuid)`;
}

/** One row over the asked-for limit is how "is there another page" is known. */
function paginate<T extends { id: string; createdAt: Date | null }>(
  rows: T[],
  limit: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last?.createdAt
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

function readCursor(raw: string | null): Cursor | null | { failure: ApiFailure } {
  const cursor = decodeCursor(raw);
  if (cursor === "invalid") {
    return { failure: { code: "invalid_request", message: "That cursor is not one of ours." } };
  }
  return cursor;
}

/**
 * An ISO 8601 instant off the query string, or the refusal.
 *
 * `new Date(x)` alone is not a parse, it is a guess: it answers `Invalid Date`
 * for nonsense but happily accepts `"2026"` and a dozen other shapes with
 * whatever the runtime feels like meaning by them. The `getTime` check is what
 * turns the guess back into a yes or no, and a caller who sent something we
 * cannot read is told so rather than silently given an unfiltered page — which
 * is the failure mode that matters here, because an unfiltered page of bookings
 * looks exactly like a correct answer to a window that happened to be empty.
 */
function readInstant(raw: string | null | undefined): Date | null | { failure: ApiFailure } {
  if (!raw) return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    return {
      failure: {
        code: "invalid_request",
        message: "Send an ISO 8601 timestamp, e.g. `2026-08-20T09:00:00Z`.",
      },
    };
  }
  return at;
}

/* -------------------------------------------------------------------------- */
/*  Shop                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * "Which shop is this key for?" — the call every integration setup screen makes
 * first, to prove the credential works and name what it connected to.
 */
export function getShop(caller: ApiCaller): Handled<ReturnType<typeof shopResource>> {
  return { ok: true, data: shopResource(caller.shop) };
}

/* -------------------------------------------------------------------------- */
/*  Orders                                                                     */
/* -------------------------------------------------------------------------- */

export type OrderFilters = ListOptions & {
  status?: string | null;
  paymentStatus?: string | null;
  email?: string | null;
};

export async function listOrders(
  caller: ApiCaller,
  options: OrderFilters,
): Promise<Handled<ReturnType<typeof orderResource>[]> & { page?: Page<unknown> }> {
  const cursor = readCursor(options.cursor);
  if (cursor && "failure" in cursor) return { ok: false, failure: cursor.failure };

  const db = getDb();
  const filters = [eq(orders.shopId, caller.shop.id)];
  if (options.status) filters.push(eq(orders.status, options.status));
  if (options.paymentStatus) filters.push(eq(orders.paymentStatus, options.paymentStatus));
  if (options.email) {
    // Folded, because an address stored as typed and an address searched for
    // as typed are the same person to everyone except an equality test.
    filters.push(sql`lower(${orders.customerEmail}) = ${options.email.toLowerCase()}`);
  }
  if (cursor) filters.push(keysetWhere(orders, cursor));

  const rows = await db
    .select()
    .from(orders)
    .where(and(...filters))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(options.limit + 1);

  const page = paginate(rows, options.limit);

  /*
   * Line items for the whole page in one query rather than one per order.
   *
   * A page of twenty-five orders is twenty-five round trips written the
   * obvious way, and this endpoint exists to be polled in a loop.
   */
  /*
   * `inArray`, not a hand-written `in ${ids}`.
   *
   * Drizzle's `sql` template binds an array as one parameter rather than
   * expanding it into a placeholder list, so the hand-written form compares a
   * uuid column against a Postgres array and matches nothing — silently, which
   * is the worst way for it to be wrong: every order comes back with an empty
   * `items` list and nothing errors.
   */
  const items = page.items.length
    ? await db
        .select()
        .from(orderItems)
        .where(inArray(orderItems.orderId, page.items.map((row) => row.id)))
        .orderBy(asc(orderItems.position))
    : [];

  const byOrder = new Map<string, typeof items>();
  for (const item of items) {
    const list = byOrder.get(item.orderId);
    if (list) list.push(item);
    else byOrder.set(item.orderId, [item]);
  }

  return {
    ok: true,
    data: page.items.map((order) => orderResource(order, byOrder.get(order.id) ?? [])),
    page,
  };
}

/*
 * Every `{id}` read starts by checking the shape of the id.
 *
 * Not defensive tidiness — the columns are `uuid`, and Postgres *raises* on a
 * malformed comparison rather than matching nothing. Without this,
 * `GET /orders/banana` is a 500 whose log line is a Postgres syntax error,
 * where the honest answer is the 404 the caller would have got for any other id
 * that is not theirs. It is the same reasoning the cursor decoder gives for
 * checking its own uuid before building a comparison out of it.
 */
export async function getOrder(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ReturnType<typeof orderResource>>> {
  if (!isUuid(id)) return notFound("order");

  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, caller.shop.id)),
  });
  if (!order) return notFound("order");

  const items = await db.query.orderItems.findMany({
    where: eq(orderItems.orderId, order.id),
    orderBy: [asc(orderItems.position)],
  });

  return { ok: true, data: orderResource(order as Order, items) };
}

/* -------------------------------------------------------------------------- */
/*  Products                                                                   */
/* -------------------------------------------------------------------------- */

export type ProductFilters = ListOptions & {
  kind?: string | null;
  published?: boolean | null;
};

export async function listProducts(
  caller: ApiCaller,
  options: ProductFilters,
): Promise<Handled<ReturnType<typeof productResource>[]> & { page?: Page<unknown> }> {
  const cursor = readCursor(options.cursor);
  if (cursor && "failure" in cursor) return { ok: false, failure: cursor.failure };

  const filters = [eq(products.shopId, caller.shop.id)];
  if (options.kind) filters.push(eq(products.kind, options.kind));
  if (options.published !== null && options.published !== undefined) {
    filters.push(eq(products.isPublished, options.published));
  }
  if (cursor) filters.push(keysetWhere(products, cursor));

  const rows = await getDb()
    .select()
    .from(products)
    .where(and(...filters))
    .orderBy(desc(products.createdAt), desc(products.id))
    .limit(options.limit + 1);

  const page = paginate(rows, options.limit);

  return {
    ok: true,
    /*
     * No variants on the list, on purpose — a page of twenty-five products
     * with every variant expanded is a large response nobody asked for, and
     * the detail endpoint is one call away for the product that matters.
     */
    data: page.items.map((product) => productResource(product, caller.shop.currency)),
    page,
  };
}

export async function getProduct(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ReturnType<typeof productResource>>> {
  if (!isUuid(id)) return notFound("product");

  const db = getDb();
  const product = await db.query.products.findFirst({
    where: and(eq(products.id, id), eq(products.shopId, caller.shop.id)),
  });
  if (!product) return notFound("product");

  const variants = await db.query.productVariants.findMany({
    where: eq(productVariants.productId, product.id),
    orderBy: [asc(productVariants.position)],
  });

  return { ok: true, data: productResource(product, caller.shop.currency, variants) };
}

/* -------------------------------------------------------------------------- */
/*  Contacts                                                                   */
/* -------------------------------------------------------------------------- */

export type ContactFilters = ListOptions & {
  tag?: string | null;
  email?: string | null;
  consented?: boolean | null;
};

export async function listContacts(
  caller: ApiCaller,
  options: ContactFilters,
): Promise<Handled<ReturnType<typeof contactResource>[]> & { page?: Page<unknown> }> {
  const cursor = readCursor(options.cursor);
  if (cursor && "failure" in cursor) return { ok: false, failure: cursor.failure };

  const filters = [eq(clients.shopId, caller.shop.id)];

  if (options.tag) {
    const tag = normalizeTag(options.tag);
    if (!tag) return invalid("That tag is not a tag we would ever have stored.");
    // Containment against the GIN index, the same question the segment
    // builder asks — not a scan with a filter on top.
    filters.push(sql`${clients.tags} && ARRAY[${tag}]::text[]`);
  }
  if (options.email) {
    filters.push(sql`lower(${clients.email}) = ${options.email.toLowerCase()}`);
  }
  if (options.consented === true) filters.push(isNotNull(clients.marketingConsentAt));
  if (cursor) filters.push(keysetWhere(clients, cursor));

  const rows = await getDb()
    .select()
    .from(clients)
    .where(and(...filters))
    .orderBy(desc(clients.createdAt), desc(clients.id))
    .limit(options.limit + 1);

  const page = paginate(rows, options.limit);

  return { ok: true, data: page.items.map(contactResource), page };
}

export async function getContact(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ReturnType<typeof contactResource>>> {
  if (!isUuid(id)) return notFound("contact");

  const client = await getDb().query.clients.findFirst({
    where: and(eq(clients.id, id), eq(clients.shopId, caller.shop.id)),
  });
  if (!client) return notFound("contact");
  return { ok: true, data: contactResource(client) };
}

/* -------------------------------------------------------------------------- */
/*  Subscriptions                                                              */
/* -------------------------------------------------------------------------- */

export type SubscriptionFilters = ListOptions & {
  status?: string | null;
  productId?: string | null;
  contactId?: string | null;
};

/**
 * The shop's memberships.
 *
 * The read the seven `subscription.*` events have been arriving without since
 * they shipped: a consumer that received `subscription.created`, stored the id
 * and later wanted to know whether that membership is still running had no way
 * to ask. That is the whole reason this exists — an event carrying an id into a
 * system with no endpoint to resolve it is half an integration, which is the
 * same sentence spec 16 opens with about webhooks and a REST API.
 *
 * `billingMode` is the field a consumer must read before concluding anything
 * about renewal. A `manual` membership is one Sailo raises renewal orders for
 * and a human settles at the door; nothing will ever arrive from Stripe about
 * it, so an integration waiting for a card renewal on one waits for ever.
 */
export async function listSubscriptions(
  caller: ApiCaller,
  options: SubscriptionFilters,
): Promise<Handled<ReturnType<typeof subscriptionResource>[]> & { page?: Page<unknown> }> {
  const cursor = readCursor(options.cursor);
  if (cursor && "failure" in cursor) return { ok: false, failure: cursor.failure };

  const filters = [eq(subscriptions.shopId, caller.shop.id)];
  if (options.status) filters.push(eq(subscriptions.status, options.status));

  /*
   * The two id filters are checked for shape before they reach the query.
   *
   * Both columns are `uuid`, and Postgres raises on a malformed comparison
   * rather than matching nothing — so an integration passing an empty string or
   * somebody else's slug would get a 500 describing our schema instead of the
   * 400 it earned.
   */
  if (options.productId) {
    if (!isUuid(options.productId)) return invalid("`product_id` is not an id we could have issued.");
    filters.push(eq(subscriptions.productId, options.productId));
  }
  if (options.contactId) {
    if (!isUuid(options.contactId)) return invalid("`contact_id` is not an id we could have issued.");
    filters.push(eq(subscriptions.clientId, options.contactId));
  }
  if (cursor) filters.push(keysetWhere(subscriptions, cursor));

  const rows = await getDb()
    .select()
    .from(subscriptions)
    .where(and(...filters))
    .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
    .limit(options.limit + 1);

  const page = paginate(rows, options.limit);

  return { ok: true, data: page.items.map(subscriptionResource), page };
}

export async function getSubscription(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ReturnType<typeof subscriptionResource>>> {
  if (!isUuid(id)) return notFound("subscription");

  const subscription = await getDb().query.subscriptions.findFirst({
    where: and(eq(subscriptions.id, id), eq(subscriptions.shopId, caller.shop.id)),
  });
  if (!subscription) return notFound("subscription");
  return { ok: true, data: subscriptionResource(subscription) };
}

/* -------------------------------------------------------------------------- */
/*  Disputes                                                                   */
/* -------------------------------------------------------------------------- */

export type DisputeFilters = ListOptions & {
  status?: string | null;
  orderId?: string | null;
};

/**
 * Chargebacks against this shop's sales.
 *
 * **`scope = 'connected'` is in the WHERE and is not a filter the caller can
 * change.** A connected dispute is a buyer charging back a seller's sale. A
 * *platform* dispute is that seller charging back their own Sailo subscription
 * — Sailo's money, Sailo's problem, and a row that has the seller's shop id on
 * it precisely so it can be counted against them. Letting it out of this
 * endpoint would put a seller's argument with us into their own Zapier account
 * dressed as a customer chargeback, which is both wrong and none of an
 * integration's business. The same reasoning keeps it out of the webhook.
 *
 * The point of reading these over an API at all is the deadline. A chargeback
 * gives about twenty days to respond and the evidence that wins it usually
 * lives somewhere that is not Sailo — a helpdesk, a fulfilment tool, a shipping
 * account — so this is what lets a seller's own tooling go and fetch it.
 */
export async function listDisputes(
  caller: ApiCaller,
  options: DisputeFilters,
): Promise<Handled<ReturnType<typeof disputeResource>[]> & { page?: Page<unknown> }> {
  const cursor = readCursor(options.cursor);
  if (cursor && "failure" in cursor) return { ok: false, failure: cursor.failure };

  const filters = [eq(disputes.shopId, caller.shop.id), eq(disputes.scope, "connected")];
  if (options.status) filters.push(eq(disputes.status, options.status));
  if (options.orderId) {
    if (!isUuid(options.orderId)) return invalid("`order_id` is not an id we could have issued.");
    filters.push(eq(disputes.orderId, options.orderId));
  }
  if (cursor) filters.push(keysetWhere(disputes, cursor));

  const rows = await getDb()
    .select()
    .from(disputes)
    .where(and(...filters))
    .orderBy(desc(disputes.createdAt), desc(disputes.id))
    .limit(options.limit + 1);

  const page = paginate(rows, options.limit);

  return { ok: true, data: page.items.map(disputeResource), page };
}

export async function getDispute(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ReturnType<typeof disputeResource>>> {
  if (!isUuid(id)) return notFound("dispute");

  const dispute = await getDb().query.disputes.findFirst({
    where: and(
      eq(disputes.id, id),
      eq(disputes.shopId, caller.shop.id),
      // Same refusal as the list, and it has to be repeated: a platform dispute
      // carries the shop id too, so ownership alone would hand one over.
      eq(disputes.scope, "connected"),
    ),
  });
  if (!dispute) return notFound("dispute");
  return { ok: true, data: disputeResource(dispute) };
}

/* -------------------------------------------------------------------------- */
/*  Bookings                                                                   */
/* -------------------------------------------------------------------------- */

export type BookingFilters = ListOptions & {
  productId?: string | null;
  staffId?: string | null;
  /** ISO 8601. Appointments starting at or after this instant. */
  from?: string | null;
  /** ISO 8601, exclusive. Appointments starting strictly before it. */
  to?: string | null;
};

/**
 * The appointments a shop owes.
 *
 * `booking_claims` carries no shop id — the product it is against is what makes
 * it a shop's — so the ownership check is the inner join to `products` and
 * cannot be omitted or reordered into a filter applied afterwards. Every row
 * this returns reached it through that join.
 *
 * **Ordered newest-booked first, like every other list here, and windowed by
 * `from`/`to` rather than sorted by start time.** The two questions a
 * calendar integration asks are "what has been booked since I last looked",
 * which is this order, and "what is in the diary for next week", which is the
 * window — and answering both without a second cursor implementation is worth
 * more than chronological rows a consumer can sort in one line. The window is
 * on when an appointment *starts*, not on overlap: an appointment that began
 * before `from` and runs into it is not in the answer.
 */
export async function listBookings(
  caller: ApiCaller,
  options: BookingFilters,
): Promise<Handled<ReturnType<typeof bookingResource>[]> & { page?: Page<unknown> }> {
  const cursor = readCursor(options.cursor);
  if (cursor && "failure" in cursor) return { ok: false, failure: cursor.failure };

  const filters = [eq(products.shopId, caller.shop.id)];

  if (options.productId) {
    if (!isUuid(options.productId)) return invalid("`product_id` is not an id we could have issued.");
    filters.push(eq(bookingClaims.productId, options.productId));
  }
  if (options.staffId) {
    if (!isUuid(options.staffId)) return invalid("`staff_id` is not an id we could have issued.");
    filters.push(eq(bookingClaims.staffId, options.staffId));
  }

  const from = readInstant(options.from);
  if (from && "failure" in from) return { ok: false, failure: from.failure };
  const to = readInstant(options.to);
  if (to && "failure" in to) return { ok: false, failure: to.failure };

  if (from) filters.push(gte(bookingClaims.startsAt, from));
  if (to) filters.push(lt(bookingClaims.startsAt, to));
  if (cursor) filters.push(keysetWhere(bookingClaims, cursor));

  const rows = await getDb()
    .select({
      claim: bookingClaims,
      productTitle: products.title,
      staffName: staffResources.name,
    })
    .from(bookingClaims)
    .innerJoin(products, eq(products.id, bookingClaims.productId))
    /*
     * Left, not inner. `staff_id` is null on a shop that books the shop rather
     * than a named person, and it stays set when a seller later removes
     * somebody from the roster — an inner join would drop exactly the
     * appointments whose staffing a consumer most needs to notice.
     */
    .leftJoin(staffResources, eq(staffResources.id, bookingClaims.staffId))
    .where(and(...filters))
    .orderBy(desc(bookingClaims.createdAt), desc(bookingClaims.id))
    .limit(options.limit + 1);

  const page = paginate(
    rows.map((row) => ({ ...row, id: row.claim.id, createdAt: row.claim.createdAt })),
    options.limit,
  );

  return {
    ok: true,
    data: page.items.map((row) =>
      bookingResource(row.claim, {
        productTitle: row.productTitle,
        staffName: row.staffName,
      }),
    ),
    page,
  };
}

export async function getBooking(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ReturnType<typeof bookingResource>>> {
  if (!isUuid(id)) return notFound("booking");

  const [row] = await getDb()
    .select({
      claim: bookingClaims,
      productTitle: products.title,
      staffName: staffResources.name,
    })
    .from(bookingClaims)
    .innerJoin(products, eq(products.id, bookingClaims.productId))
    .leftJoin(staffResources, eq(staffResources.id, bookingClaims.staffId))
    .where(and(eq(bookingClaims.id, id), eq(products.shopId, caller.shop.id)))
    .limit(1);

  if (!row) return notFound("booking");

  return {
    ok: true,
    data: bookingResource(row.claim, {
      productTitle: row.productTitle,
      staffName: row.staffName,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/*  Staff                                                                      */
/* -------------------------------------------------------------------------- */

export type StaffFilters = ListOptions & {
  active?: boolean | null;
};

/**
 * The bookable roster.
 *
 * Read `staffResource` for what this is not: these are names a buyer can pick,
 * not accounts, not logins and not the seller's colleagues. Nothing here can
 * sign in to anything.
 */
export async function listStaff(
  caller: ApiCaller,
  options: StaffFilters,
): Promise<Handled<ReturnType<typeof staffResource>[]> & { page?: Page<unknown> }> {
  const cursor = readCursor(options.cursor);
  if (cursor && "failure" in cursor) return { ok: false, failure: cursor.failure };

  const filters = [eq(staffResources.shopId, caller.shop.id)];
  if (options.active !== null && options.active !== undefined) {
    filters.push(eq(staffResources.isActive, options.active));
  }
  if (cursor) filters.push(keysetWhere(staffResources, cursor));

  const rows = await getDb()
    .select()
    .from(staffResources)
    .where(and(...filters))
    .orderBy(desc(staffResources.createdAt), desc(staffResources.id))
    .limit(options.limit + 1);

  const page = paginate(rows, options.limit);

  return { ok: true, data: page.items.map(staffResource), page };
}

export async function getStaff(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ReturnType<typeof staffResource>>> {
  if (!isUuid(id)) return notFound("staff member");

  const staff = await getDb().query.staffResources.findFirst({
    where: and(eq(staffResources.id, id), eq(staffResources.shopId, caller.shop.id)),
  });
  if (!staff) return notFound("staff member");
  return { ok: true, data: staffResource(staff) };
}

/* -------------------------------------------------------------------------- */
/*  Contact lists                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The two counts, as one filtered aggregate rather than a query per list.
 *
 * A left join so a list nobody has joined reports zero instead of vanishing —
 * the empty list is usually the one the seller just made and is looking for.
 */
const LIST_COUNTS = {
  subscribed: sql<string>`count(*) filter (where ${contactListMembers.status} = 'subscribed')`,
  pending: sql<string>`count(*) filter (where ${contactListMembers.status} = 'pending')`,
};

const listCounts = (row: { subscribed: string | null; pending: string | null }) => ({
  subscribed: Number(row.subscribed ?? 0),
  pending: Number(row.pending ?? 0),
});

/**
 * The shop's lists, with the numbers a send would actually reach.
 *
 * The read that makes `docs/…/guides/sync-a-crm` true rather than aspirational:
 * a contact's tags were already fetchable, but the lists they are on — which is
 * what a seller actually segments a broadcast by — were not, so a CRM mirror
 * could copy the labels and not the audiences.
 */
export async function listLists(
  caller: ApiCaller,
  options: ListOptions,
): Promise<Handled<ReturnType<typeof contactListResource>[]> & { page?: Page<unknown> }> {
  const cursor = readCursor(options.cursor);
  if (cursor && "failure" in cursor) return { ok: false, failure: cursor.failure };

  const filters = [eq(contactLists.shopId, caller.shop.id)];
  if (cursor) filters.push(keysetWhere(contactLists, cursor));

  const rows = await getDb()
    .select({ list: contactLists, ...LIST_COUNTS })
    .from(contactLists)
    .leftJoin(contactListMembers, eq(contactListMembers.listId, contactLists.id))
    .where(and(...filters))
    .groupBy(contactLists.id)
    .orderBy(desc(contactLists.createdAt), desc(contactLists.id))
    .limit(options.limit + 1);

  const page = paginate(
    rows.map((row) => ({ ...row, id: row.list.id, createdAt: row.list.createdAt })),
    options.limit,
  );

  return {
    ok: true,
    data: page.items.map((row) => contactListResource(row.list, listCounts(row))),
    page,
  };
}

export async function getList(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ReturnType<typeof contactListResource>>> {
  if (!isUuid(id)) return notFound("list");

  const [row] = await getDb()
    .select({ list: contactLists, ...LIST_COUNTS })
    .from(contactLists)
    .leftJoin(contactListMembers, eq(contactListMembers.listId, contactLists.id))
    .where(and(eq(contactLists.id, id), eq(contactLists.shopId, caller.shop.id)))
    .groupBy(contactLists.id)
    .limit(1);

  if (!row) return notFound("list");
  return { ok: true, data: contactListResource(row.list, listCounts(row)) };
}

/* -------------------------------------------------------------------------- */
/*  Flows (automations)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The second gate, and it is not the one `apiGuard` runs.
 *
 * `apiGuard` answers "may this shop use the API at all", which is a different
 * question from "does this shop have automations" — and the admin's own
 * `gate()` in `actions/flows.ts` asks the second one before every write.
 *
 * **It cannot fire today, and it is here anyway.** `integrations` and
 * `automations` are both Business-only, so a shop that fails this has already
 * failed the API gate one step earlier and been refused with a different
 * sentence. They are two separate flags in the plan table, though, and the day
 * one of them moves — the API opening up on Pro is the obvious direction —
 * this is the difference between a Pro shop reading a Business feature and
 * being told it cannot. A gate that costs one boolean and closes that is worth
 * keeping ahead of the change rather than after it.
 *
 * Returned as a refusal rather than an empty page on purpose: a shop with no
 * automations and a shop that may not have them are different facts, and an
 * integration that saw `[]` would conclude the seller has no flows and stop
 * asking.
 */
function requireAutomations(caller: ApiCaller): { failure: ApiFailure } | null {
  if (can(caller.shop, "automations")) return null;
  const plan = cheapestPlanWith("automations");
  return {
    failure: {
      code: "forbidden",
      message: `Automations are available on ${plan?.name ?? "a higher plan"}.`,
    },
  };
}

/**
 * The node list, flattened out of the stored graph.
 *
 * Read straight off the jsonb rather than through `parseGraph`, deliberately.
 * The parser answers "is this graph runnable" and returns `Map`s that are not
 * JSON — but a flow that has stopped parsing is exactly the flow a seller most
 * needs to see in a list, and a reader that refused to describe it would hide
 * the broken one. Order comes from the stored array, which is the order the
 * builder wrote and the order the runner walks.
 */
function stepsOf(automation: typeof automations.$inferSelect) {
  const nodes = automation.graph?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((node): node is { id: string; kind: string } =>
      Boolean(node && typeof node.id === "string" && typeof node.kind === "string"),
    )
    .map((node) => ({ id: node.id, kind: node.kind }));
}

export type FlowFilters = ListOptions & {
  status?: string | null;
  kind?: string | null;
};

/**
 * The shop's automations.
 *
 * Deliberately without run tallies. Counting live runs per flow is a second
 * query against a table that grows with every contact who ever entered one,
 * and a page of flows should not pay for it when the overwhelming majority of
 * callers want the names, the triggers and whether each is running. `GET
 * /flows/{id}` carries the counts for the one flow somebody is actually
 * looking at, which is where the cost belongs.
 */
export async function listFlows(
  caller: ApiCaller,
  options: FlowFilters,
): Promise<Handled<ReturnType<typeof flowResource>[]> & { page?: Page<unknown> }> {
  const gate = requireAutomations(caller);
  if (gate) return { ok: false, failure: gate.failure };

  const cursor = readCursor(options.cursor);
  if (cursor && "failure" in cursor) return { ok: false, failure: cursor.failure };

  /*
   * `kind` defaults to `email` rather than to everything, and matches what the
   * admin lists. An email flow is a sequence a seller drew; a scenario is a
   * one-step rule wired to an outside app. They are different objects with
   * different screens, and folding them into one unfiltered page would mean a
   * consumer counting "my flows" got a number the seller has never seen.
   */
  const filters = [
    eq(automations.shopId, caller.shop.id),
    eq(automations.kind, options.kind || "email"),
  ];
  if (options.status) filters.push(eq(automations.status, options.status));
  if (cursor) filters.push(keysetWhere(automations, cursor));

  const rows = await getDb()
    .select()
    .from(automations)
    .where(and(...filters))
    .orderBy(desc(automations.createdAt), desc(automations.id))
    .limit(options.limit + 1);

  const page = paginate(rows, options.limit);

  return {
    ok: true,
    data: page.items.map((row) => flowResource(row, { steps: stepsOf(row) })),
    page,
  };
}

export async function getFlow(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ReturnType<typeof flowResource>>> {
  const gate = requireAutomations(caller);
  if (gate) return { ok: false, failure: gate.failure };
  if (!isUuid(id)) return notFound("flow");

  const flow = await getDb().query.automations.findFirst({
    where: and(eq(automations.id, id), eq(automations.shopId, caller.shop.id)),
  });
  if (!flow) return notFound("flow");

  /*
   * One grouped statement rather than five counts. `automation_runs_automation_idx`
   * is `(automation_id, status)`, so this is an index-only scan over one flow's
   * runs — and it is why the tallies are on the detail endpoint and not on the
   * list, where it would be one such scan per row.
   */
  const tallies = await getDb()
    .select({ status: automationRuns.status, n: sql<string>`count(*)` })
    .from(automationRuns)
    .where(eq(automationRuns.automationId, flow.id))
    .groupBy(automationRuns.status);

  const by = (status: string) =>
    Number(tallies.find((row) => row.status === status)?.n ?? 0);

  const queued = by("queued");
  const waiting = by("waiting");

  return {
    ok: true,
    data: flowResource(flow, {
      steps: stepsOf(flow),
      runs: {
        total: tallies.reduce((sum, row) => sum + Number(row.n ?? 0), 0),
        /* Queued and waiting together: both are people still inside the flow,
           and the difference between them is whether a timer is running. */
        live: queued + waiting,
        completed: by("done"),
        failed: by("failed"),
        cancelled: by("cancelled"),
      },
    }),
  };
}

export type FlowRunFilters = ListOptions & {
  status?: string | null;
  email?: string | null;
};

/**
 * Who has walked one flow, and where each of them got to.
 *
 * The read that answers "why did this customer not get the email", which is
 * the question a seller brings to support and which nothing outside the
 * database could answer until now.
 *
 * **Ordered by `entered_at`, not `created_at`.** This table has no
 * `created_at` — when somebody entered the flow is the only time it records —
 * so the cursor is built over `(entered_at, id)` and the column is aliased
 * into the shape `paginate` reads. `automation_runs_flow_keyset_idx` exists
 * for exactly this ordering.
 */
export async function listFlowRuns(
  caller: ApiCaller,
  flowId: string,
  options: FlowRunFilters,
): Promise<Handled<ReturnType<typeof flowRunResource>[]> & { page?: Page<unknown> }> {
  const gate = requireAutomations(caller);
  if (gate) return { ok: false, failure: gate.failure };
  if (!isUuid(flowId)) return notFound("flow");

  const cursor = readCursor(options.cursor);
  if (cursor && "failure" in cursor) return { ok: false, failure: cursor.failure };

  /*
   * The flow is loaded first and scoped to the shop, so the runs query can key
   * on `automation_id` alone and still be safe. `automation_runs` carries its
   * own `shop_id` as well, and both are in the WHERE below: the denormalised
   * column is fast, and the ownership was already proven here.
   */
  const flow = await getDb().query.automations.findFirst({
    where: and(eq(automations.id, flowId), eq(automations.shopId, caller.shop.id)),
    columns: { id: true },
  });
  if (!flow) return notFound("flow");

  const filters = [
    eq(automationRuns.automationId, flow.id),
    eq(automationRuns.shopId, caller.shop.id),
  ];
  if (options.status) filters.push(eq(automationRuns.status, options.status));
  if (options.email) {
    filters.push(sql`lower(${automationRuns.email}) = ${options.email.toLowerCase()}`);
  }
  if (cursor) {
    filters.push(
      sql`(${automationRuns.enteredAt}, ${automationRuns.id}) < (${cursor.createdAt.toISOString()}::timestamp, ${cursor.id}::uuid)`,
    );
  }

  const rows = await getDb()
    .select()
    .from(automationRuns)
    .where(and(...filters))
    .orderBy(desc(automationRuns.enteredAt), desc(automationRuns.id))
    .limit(options.limit + 1);

  const page = paginate(
    rows.map((row) => ({ ...row, createdAt: row.enteredAt })),
    options.limit,
  );

  return { ok: true, data: page.items.map(flowRunResource), page };
}

/* -------------------------------------------------------------------------- */
/*  Writes                                                                     */
/* -------------------------------------------------------------------------- */

export type ContactInput = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  tags?: unknown;
  sendOptIn?: unknown;
};

/**
 * Add somebody to a shop's list — the write that makes "a form on my own site
 * feeds Sailo" possible.
 *
 * **It cannot grant consent, and that is the whole design of it.**
 * `marketingConsentAt` stays null however the caller asks, exactly as it does
 * for a contact typed into the admin and for one imported from a CSV. The
 * comment on that column says it plainly: consent is a thing a person gave,
 * and a field in a request body is a claim that they did. An API that accepted
 * the claim would be the hole through which every scraped list on the internet
 * becomes a "consented" audience with our domain's reputation behind it.
 *
 * `sendOptIn` is the way to actually get consent, and it does the only thing
 * that can produce it: sends the person the same double opt-in email the
 * public signup form sends, so the consent is written when *they* click. It
 * reuses that flow rather than reimplementing it, which is why the token,
 * the seven-day expiry and the suppression rules all apply unchanged.
 */
export async function upsertContact(
  caller: ApiCaller,
  input: ContactInput,
): Promise<Handled<ReturnType<typeof contactResource> & { optInSent: boolean }>> {
  const email = normalizeEmail(input.email);
  const phone = typeof input.phone === "string" ? normalizePhone(input.phone) : null;
  const name = normalizeName(input.name);

  if (!email && !phone) {
    return { ok: false, failure: { code: "invalid_request", message: "Give an email or a phone number." } };
  }
  if (input.email && !email) {
    return { ok: false, failure: { code: "invalid_request", message: `That is not an email address we can store (max ${MAX_EMAIL_LENGTH} characters).` } };
  }

  const { tags, truncated } = normalizeTags(input.tags ?? "");

  const db = getDb();

  /*
   * `onConflictDoNothing` with no target, covering both unique indexes —
   * (shop, email) and (shop, phone) — where a targeted upsert could only
   * cover one. This is the same shape `addClient` and `upsertClient` use, and
   * for the same reason: two calls in flight together both pass a read.
   */
  const inserted = await db
    .insert(clients)
    .values({
      shopId: caller.shop.id,
      name: name ?? email ?? phone ?? "Contact",
      email,
      phone,
      tags,
      source: "api",
      marketingConsentAt: null,
    })
    .onConflictDoNothing()
    .returning();

  let record = inserted[0];

  if (!record) {
    /*
     * They already exist. Updating rather than refusing, because the caller's
     * intent — "this person should be on the list, with these tags" — is
     * satisfied either way, and an integration that has to handle 409 by
     * looking the person up and calling a second endpoint is one nobody
     * finishes wiring.
     *
     * Tags are merged, never replaced. A tag the seller added by hand is not
     * something a form submission should be able to delete.
     */
    const existing = await db.query.clients.findFirst({
      where: and(
        eq(clients.shopId, caller.shop.id),
        email
          ? sql`lower(${clients.email}) = ${email.toLowerCase()}`
          : eq(clients.phone, phone as string),
      ),
    });
    if (!existing) return notFound("contact");

    const merged = [...new Set([...existing.tags, ...tags])].slice(0, MAX_TAGS);
    const updated = await db
      .update(clients)
      .set({
        // A name from a form fills a gap; it never overwrites one the seller
        // or an order already knows.
        name: existing.name === "Anonymous" ? (name ?? existing.name) : existing.name,
        phone: existing.phone ?? phone,
        email: existing.email ?? email,
        tags: merged,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, existing.id))
      .returning();

    record = updated[0] ?? existing;
  }

  let optInSent = false;
  if (input.sendOptIn === true && email) {
    optInSent = await sendOptIn(caller, email, name);
  }

  const data = record
    ? { ...contactResource(record), optInSent }
    : null;
  if (!data) return notFound("contact");

  if (truncated) {
    // Never a silent cap. The response says what was kept.
    return { ok: true, data: { ...data, tags: data.tags.slice(0, MAX_TAGS) } };
  }
  return { ok: true, data };
}

/**
 * Sends the double opt-in email, rate-limited per address exactly as the
 * public form is.
 *
 * The limit is the point, not a formality: without it this endpoint is a way
 * to have Sailo's mail servers deliver a message to any address anyone names,
 * as many times as they like, with a seller's shop name on it.
 */
async function sendOptIn(
  caller: ApiCaller,
  email: string,
  name: string | null,
): Promise<boolean> {
  const budget = await rateLimit(
    `subscribe-email:${caller.shop.handle}:${email}`,
    2,
    3_600,
  );
  if (!budget.allowed) return false;

  const token = subscribeToken({ shopId: caller.shop.id, email, name });
  if (!token) return false;

  const dict = getDictionary(caller.shop.locale ?? "en");
  const result = await sendSubscribeConfirmation({
    shop: caller.shop,
    to: email,
    name,
    confirmUrl: confirmUrl(token),
    labels: {
      subject: interpolate(dict.mailing.confirmSubject, { shop: caller.shop.name }),
      title: dict.mailing.confirmTitle,
      body: interpolate(dict.mailing.confirmEmailBody, { shop: caller.shop.name }),
      cta: dict.mailing.confirmCta,
    },
  });

  return result.sent;
}

/**
 * Adds and removes a contact's tags.
 *
 * Separate from the upsert because it is the operation an automation actually
 * wants — "tag everyone who attended" — and doing it through the upsert would
 * mean the caller sending a name and an email they may not have just to change
 * a label.
 */
export async function tagContact(
  caller: ApiCaller,
  id: string,
  input: { add?: unknown; remove?: unknown },
): Promise<Handled<ReturnType<typeof contactResource>>> {
  if (!isUuid(id)) return notFound("contact");

  const db = getDb();
  const existing = await db.query.clients.findFirst({
    where: and(eq(clients.id, id), eq(clients.shopId, caller.shop.id)),
  });
  if (!existing) return notFound("contact");

  const add = normalizeTags(input.add ?? "").tags;
  const remove = new Set(normalizeTags(input.remove ?? "").tags);

  if (add.length === 0 && remove.size === 0) {
    return invalid("Send `add`, `remove`, or both.");
  }

  const next = [...new Set([...existing.tags, ...add])]
    .filter((tag) => !remove.has(tag))
    .slice(0, MAX_TAGS);

  const updated = await db
    .update(clients)
    .set({ tags: next, updatedAt: new Date() })
    .where(eq(clients.id, existing.id))
    .returning();

  const record = updated[0];
  return record ? { ok: true, data: contactResource(record) } : notFound("contact");
}

/**
 * A contact and every list they are on.
 *
 * The shape both list endpoints answer with, so one parser handles the read and
 * the write. The memberships are always read back from the database rather than
 * assembled from what a write was asked to do — a list id that is not this
 * shop's is a no-op inside `joinList`, so what was requested and what is true
 * are different things and only one of them is worth returning.
 */
type ContactWithLists = ReturnType<typeof contactResource> & {
  lists: { id: string; name: string; status: string; joinedAt: string | null }[];
};

async function contactWithLists(
  caller: ApiCaller,
  contact: Parameters<typeof contactResource>[0],
): Promise<ContactWithLists> {
  const memberships = await listsForClient(caller.shop.id, contact.id);
  return {
    ...contactResource(contact),
    lists: memberships.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      joinedAt: iso(row.joinedAt),
    })),
  };
}

/**
 * Which lists one contact is on.
 *
 * Its own endpoint rather than a field on the contact, because it is a join
 * every caller would otherwise pay for on every read of every contact — and the
 * overwhelming majority of reads here are a CRM mirror that wants the person,
 * not their memberships. `status` per membership is the whole value of it:
 * `subscribed` will receive the next broadcast and `pending` will not, and a
 * consumer that cannot tell them apart will report an audience that does not
 * exist.
 */
export async function getContactLists(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ContactWithLists>> {
  if (!isUuid(id)) return notFound("contact");

  const contact = await getDb().query.clients.findFirst({
    where: and(eq(clients.id, id), eq(clients.shopId, caller.shop.id)),
  });
  if (!contact) return notFound("contact");

  return { ok: true, data: await contactWithLists(caller, contact) };
}

/**
 * Puts a contact on lists and takes them off others.
 *
 * The list counterpart of `tagContact`, and the same shape on purpose: add and
 * remove rather than replace, because a list membership a seller created by
 * hand is not something an automation should be able to delete by leaving it
 * out of an array. `join` and `leave` are named for what they do to a person
 * rather than to a set, because the two verbs have genuinely different
 * consequences here and `add`/`remove` would suggest otherwise.
 *
 * **Joining cannot manufacture a subscriber, and that is the point of it.** On
 * a double-opt-in list — which is the default — a join lands as `pending` and
 * stays there until the person clicks a link in their own inbox. The response
 * says which state each membership actually settled in, so a caller never has
 * to assume: `subscribed` means they will receive the next broadcast, `pending`
 * means they will not. This is the same refusal `upsertContact` makes about
 * `marketingConsentAt`, one level down — consent is a thing a person gave, and
 * an array in a request body is a claim that they did.
 *
 * **Leaving is `removed`, never a delete and never a suppression.** A deleted
 * membership would lose the fact that they left and the next import would put
 * them back; a suppression would end every list at once, which is a different
 * verb the seller has a different button for. The other lists this person is on
 * are untouched.
 */
export async function updateContactLists(
  caller: ApiCaller,
  id: string,
  input: { join?: unknown; leave?: unknown },
): Promise<Handled<ContactWithLists>> {
  if (!isUuid(id)) return notFound("contact");

  const join = readListIds(input.join);
  const leave = readListIds(input.leave);
  if ("failure" in join) return { ok: false, failure: join.failure };
  if ("failure" in leave) return { ok: false, failure: leave.failure };

  if (join.ids.length === 0 && leave.ids.length === 0) {
    return invalid("Send `join`, `leave`, or both.");
  }

  const db = getDb();
  const contact = await db.query.clients.findFirst({
    where: and(eq(clients.id, id), eq(clients.shopId, caller.shop.id)),
  });
  if (!contact) return notFound("contact");

  /*
   * Joins run one at a time, and that is a real cost worth naming.
   *
   * Each `joinList` is two lookups, an upsert, and — when the membership
   * actually settles as subscribed — an automation enrolment that is itself
   * several statements. That is why `MAX_WRITE_LISTS` below is much smaller
   * than the shop's list ceiling: capping this call by how many lists a shop
   * *may hold* would let one request issue several hundred sequential
   * statements, which at 240 requests a minute is a comfortable way for one
   * key to exhaust a connection pool.
   *
   * They stay sequential rather than becoming `Promise.all` because each is an
   * upsert on `(list, client)` that can fire an enrolment, and a fan-out of
   * those against one contact is a race with itself.
   */
  for (const listId of join.ids) {
    /*
     * `force` is never passed. It is how an *import* skips the pending state on
     * the seller's own claim that they collected consent offline, and it is not
     * a claim an API caller is in a position to make.
     */
    await joinList({
      shopId: caller.shop.id,
      listId,
      clientId: contact.id,
      source: "api",
    });
  }

  /*
   * Leaves go in one statement rather than one apiece.
   *
   * They are independent, idempotent and — unlike a join — trigger nothing: no
   * enrolment, no send, no consent decision. So the loop bought nothing and
   * cost a round trip per list. The ownership check is the same correlated
   * `EXISTS` on `contact_lists` that `leaveList` uses, kept as a subquery in
   * the same statement rather than a lookup above it, because
   * `contact_list_members` has no `shop_id` of its own and check-then-act here
   * would be a genuine TOCTOU on a table any signed-in seller can name a row
   * in.
   *
   * `leave` is applied after `join` so that a caller naming one list in both
   * arrays ends with the contact off it. Removal is the safer half of a
   * contradiction to honour.
   */
  if (leave.ids.length > 0) {
    await db
      .update(contactListMembers)
      .set({ status: "removed", removedAt: new Date() })
      .where(
        and(
          eq(contactListMembers.clientId, contact.id),
          inArray(contactListMembers.listId, leave.ids),
          sql`exists (
            select 1 from ${contactLists}
            where ${contactLists.id} = ${contactListMembers.listId}
              and ${contactLists.shopId} = ${caller.shop.id}
          )`,
        ),
      );
  }

  /*
   * Read back rather than assembled from what the writes returned. A list id
   * that is not this shop's is a no-op inside `joinList`, so the only honest
   * account of where the contact ended up is the one the database gives — and
   * it is the same account `getContactLists` gives, from the same helper.
   */
  return { ok: true, data: await contactWithLists(caller, contact) };
}

/**
 * How many lists one call may name, per array.
 *
 * **Not `MAX_LISTS_PER_SHOP`, which is what this used to be and was the wrong
 * constant.** That number bounds what a shop may *hold*; this bounds what one
 * request may *do*, and the two are only the same if the work per list is
 * free. It is not: a join is two lookups, an upsert, and — when the membership
 * settles as subscribed — an automation enrolment that is several statements
 * more. Capping at the shop ceiling let one request issue several hundred
 * sequential statements, and at 240 requests a minute per key that is a
 * comfortable way to exhaust a connection pool without doing anything a rate
 * limiter would call abusive.
 *
 * Twenty is well above what any real integration sends — a contact joining
 * more than a handful of lists at once is a bulk import, which has its own
 * path — and low enough that the worst request is bounded.
 */
export const MAX_WRITE_LISTS = 20;

/**
 * List ids off a request body — uuid-shaped, deduplicated and capped.
 */
function readListIds(
  raw: unknown,
): { ids: string[] } | { failure: ApiFailure } {
  if (raw === undefined || raw === null) return { ids: [] };
  if (!Array.isArray(raw)) {
    return { failure: { code: "invalid_request", message: "`join` and `leave` are arrays of list ids." } };
  }
  if (raw.length > MAX_WRITE_LISTS) {
    return {
      failure: {
        code: "invalid_request",
        message: `Name at most ${MAX_WRITE_LISTS} lists per call.`,
      },
    };
  }

  const ids = [...new Set(raw.filter(isUuid))];
  if (ids.length !== new Set(raw).size) {
    return { failure: { code: "invalid_request", message: "One of those list ids is not an id we could have issued." } };
  }
  return { ids };
}
