import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  clients,
  orderItems,
  orders,
  productVariants,
  products,
  type Order,
} from "@/db/schema";
import { MAX_TAGS, normalizeTag, normalizeTags } from "@/lib/client-tags";
import { normalizePhone } from "@/lib/utils";
import {
  MAX_EMAIL_LENGTH,
  confirmUrl,
  normalizeEmail,
  normalizeName,
  subscribeToken,
} from "@/lib/broadcasts/subscribe";
import { sendSubscribeConfirmation } from "@/lib/email";
import { getDictionary, interpolate } from "@/i18n";
import { rateLimit } from "@/lib/redis";
import type { ApiCaller } from "./auth";
import {
  contactResource,
  orderResource,
  productResource,
  shopResource,
} from "./resources";
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

export async function getOrder(
  caller: ApiCaller,
  id: string,
): Promise<Handled<ReturnType<typeof orderResource>>> {
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
  const client = await getDb().query.clients.findFirst({
    where: and(eq(clients.id, id), eq(clients.shopId, caller.shop.id)),
  });
  if (!client) return notFound("contact");
  return { ok: true, data: contactResource(client) };
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
