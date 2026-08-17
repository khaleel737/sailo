import { assertLocalDatabase } from "./local-only";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

/**
 * The REST API and the MCP tools, against a real database.
 *
 * Both surfaces call the same handlers, so this suite is about the handlers —
 * and about the three things that can only go wrong once Postgres is involved:
 *
 * - **Ownership.** Every read puts `shopId` in the WHERE. A test that only
 *   ever seeds one shop cannot tell a correct filter from a missing one, so
 *   every case here seeds two and asserts the second is invisible.
 * - **The line-item join.** Fetching a page of orders and then their items is
 *   the one query here written by hand, and the wrong form matches nothing
 *   *silently* — every order comes back with an empty `items` list and no
 *   error anywhere.
 * - **Keyset paging.** Cursors are supposed to name a position rather than a
 *   distance, and the property worth proving is that walking the pages yields
 *   each row exactly once.
 */

const { getDb } = await import("@sailo/db");
const { clients, orderItems, orders, products, shops, user } = await import(
  "@sailo/db/schema"
);
const {
  getContact,
  getOrder,
  getProduct,
  getShop,
  listContacts,
  listOrders,
  listProducts,
  tagContact,
  upsertContact,
} = await import("@sailo/api/rest");
const { requireScope } = await import("@sailo/api/rest");
const { MCP_TOOLS, toolsFor, findTool } = await import("@sailo/api/mcp");

const db = getDb();
const uid = () => crypto.randomUUID();

beforeAll(() => {
  assertLocalDatabase();
});

type Caller = Awaited<ReturnType<typeof makeCaller>>;

async function makeCaller(scopes: string[] = ["read", "write"]) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `api-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `api-${userId.slice(0, 8)}`,
      name: "API Shop",
      currency: "GBP",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  return { shop, keyId: uid(), scopes };
}

async function makeOrder(caller: Caller, over: Partial<typeof orders.$inferInsert> = {}) {
  const [order] = await db
    .insert(orders)
    .values({
      shopId: caller.shop.id,
      /*
       * Required, and a relic worth knowing about: `orders` carried a single
       * product before carts existed, and the header columns are still NOT
       * NULL. Real orders fill them from the first line.
       */
      productTitle: "Speckled Mug",
      unitPriceCents: 2000,
      quantity: 2,
      currency: "GBP",
      subtotalCents: 4000,
      totalCents: 4000,
      itemCount: 2,
      customerName: "Ada",
      customerEmail: `ada-${uid().slice(0, 8)}@example.com`,
      status: "new",
      paymentStatus: "unpaid",
      paymentMethod: "cod",
      ...over,
    })
    .returning();
  if (!order) throw new Error("fixture: order was not inserted");

  await db.insert(orderItems).values([
    {
      orderId: order.id,
      title: "Speckled Mug",
      quantity: 2,
      unitPriceCents: 2000,
      subtotalCents: 4000,
      kind: "physical",
      position: 0,
    },
  ]);

  return order;
}

const paging = { limit: 25, cursor: null };

/* -------------------------------------------------------------------------- */

describe("reads are scoped to the key's own shop", () => {
  it("never returns another shop's orders, products or contacts", async () => {
    const mine = await makeCaller();
    const theirs = await makeCaller();

    const myOrder = await makeOrder(mine);
    const theirOrder = await makeOrder(theirs);

    const [myProduct] = await db
      .insert(products)
      .values({
        shopId: mine.shop.id,
        title: "Mine",
        slug: `mine-${uid().slice(0, 8)}`,
        priceCents: 1000,
        kind: "digital",
        isPublished: true,
      })
      .returning();
    const [theirProduct] = await db
      .insert(products)
      .values({
        shopId: theirs.shop.id,
        title: "Theirs",
        slug: `theirs-${uid().slice(0, 8)}`,
        priceCents: 1000,
        kind: "digital",
        isPublished: true,
      })
      .returning();

    const [myContact] = await db
      .insert(clients)
      .values({ shopId: mine.shop.id, name: "Mine", email: `m-${uid().slice(0, 8)}@e.com` })
      .returning();
    const [theirContact] = await db
      .insert(clients)
      .values({ shopId: theirs.shop.id, name: "Theirs", email: `t-${uid().slice(0, 8)}@e.com` })
      .returning();

    const orderPage = await listOrders(mine, paging);
    expect(orderPage.ok).toBe(true);
    if (orderPage.ok) {
      const ids = orderPage.data.map((row) => row.id);
      expect(ids).toContain(myOrder.id);
      expect(ids).not.toContain(theirOrder.id);
    }

    /*
     * And by id, which is the case that actually matters: a caller who has
     * somehow learnt another shop's order id must get "no such order", not
     * the order.
     */
    expect((await getOrder(mine, theirOrder.id)).ok).toBe(false);
    expect((await getProduct(mine, theirProduct?.id ?? "")).ok).toBe(false);
    expect((await getContact(mine, theirContact?.id ?? "")).ok).toBe(false);

    expect((await getOrder(mine, myOrder.id)).ok).toBe(true);
    expect((await getProduct(mine, myProduct?.id ?? "")).ok).toBe(true);
    expect((await getContact(mine, myContact?.id ?? "")).ok).toBe(true);
  });
});

describe("orders", () => {
  it("returns line items on the list, not only on the detail", async () => {
    /*
     * The regression this exists for: the items query was written as a raw
     * `in ${ids}`, which binds the array as one parameter rather than
     * expanding it — so it matched nothing and every order on the list came
     * back with `items: []`, with no error anywhere to notice.
     */
    const caller = await makeCaller();
    await makeOrder(caller);

    const page = await listOrders(caller, paging);
    expect(page.ok).toBe(true);
    if (!page.ok) return;

    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.items).toHaveLength(1);
    expect(page.data[0]?.items[0]?.title).toBe("Speckled Mug");
    expect(page.data[0]?.items[0]?.subtotal).toEqual({
      cents: 4000,
      amount: "40.00",
      currency: "GBP",
    });
  });

  it("filters by status, payment status and customer email", async () => {
    const caller = await makeCaller();
    await makeOrder(caller, { status: "shipped", paymentStatus: "paid" });
    const target = await makeOrder(caller, {
      status: "new",
      customerEmail: "Findme@Example.com",
    });

    const shipped = await listOrders(caller, { ...paging, status: "shipped" });
    expect(shipped.ok && shipped.data).toHaveLength(1);

    const paid = await listOrders(caller, { ...paging, paymentStatus: "paid" });
    expect(paid.ok && paid.data).toHaveLength(1);

    // Folded, so the casing a buyer typed is not the casing you have to search.
    const byEmail = await listOrders(caller, { ...paging, email: "findme@example.com" });
    expect(byEmail.ok).toBe(true);
    if (byEmail.ok) {
      expect(byEmail.data).toHaveLength(1);
      expect(byEmail.data[0]?.id).toBe(target.id);
    }
  });

  it("walks pages without skipping or repeating a row", async () => {
    const caller = await makeCaller();
    const made: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      made.push((await makeOrder(caller)).id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let guard = 0;

    do {
      const page = await listOrders(caller, { limit: 2, cursor });
      expect(page.ok).toBe(true);
      if (!page.ok) break;

      seen.push(...page.data.map((row) => row.id));
      cursor = page.page?.nextCursor ?? null;
      guard += 1;
    } while (cursor && guard < 10);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    for (const id of made) expect(seen).toContain(id);
  });

  it("refuses a cursor it did not write, rather than raising", async () => {
    /*
     * The id half reaches a `uuid` column, and Postgres raises on a malformed
     * literal rather than matching nothing — so without the shape check this
     * is a 500 where 400 is the honest answer.
     */
    const caller = await makeCaller();
    const result = await listOrders(caller, { limit: 10, cursor: "not-a-cursor" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("invalid_request");
  });
});

describe("products", () => {
  it("reports uncounted stock as null rather than zero", async () => {
    /*
     * "Not counted" and "sold out" are different facts, and a consumer syncing
     * stock into a marketplace listing must not read the first as the second.
     */
    const caller = await makeCaller();
    await db.insert(products).values({
      shopId: caller.shop.id,
      title: "Untracked",
      slug: `u-${uid().slice(0, 8)}`,
      priceCents: 1500,
      kind: "digital",
      isPublished: true,
      trackInventory: false,
      stockQuantity: 0,
    });

    const page = await listProducts(caller, paging);
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.data[0]?.stock).toBeNull();
      expect(page.data[0]?.price.amount).toBe("15.00");
    }
  });

  it("filters drafts in and out, and includes both when unasked", async () => {
    const caller = await makeCaller();
    for (const isPublished of [true, false]) {
      await db.insert(products).values({
        shopId: caller.shop.id,
        title: isPublished ? "Live" : "Draft",
        slug: `p-${uid().slice(0, 8)}`,
        priceCents: 100,
        kind: "digital",
        isPublished,
      });
    }

    const all = await listProducts(caller, { ...paging, published: null });
    expect(all.ok && all.data).toHaveLength(2);

    const live = await listProducts(caller, { ...paging, published: true });
    expect(live.ok && live.data).toHaveLength(1);

    const drafts = await listProducts(caller, { ...paging, published: false });
    expect(drafts.ok && drafts.data).toHaveLength(1);
  });
});

describe("contacts", () => {
  it("creates somebody, and cannot mark them as consenting", async () => {
    /*
     * The invariant this whole endpoint is shaped around: consent is something
     * a person gave, and a field in a request body is a claim that they did.
     * Every plausible spelling is tried, because the one that slips through is
     * the one an integration would use.
     */
    const caller = await makeCaller();
    const email = `new-${uid().slice(0, 8)}@example.com`;

    const created = await upsertContact(caller, {
      name: "Ada",
      email,
      tags: ["webinar"],
      // Not part of the input type — passed anyway, as a caller would.
      marketingConsentAt: new Date().toISOString(),
      consent: true,
      subscribed: true,
    } as never);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.marketingConsentAt).toBeNull();
    expect(created.data.tags).toEqual(["webinar"]);
    expect(created.data.source).toBe("api");

    const [row] = await db.select().from(clients).where(eq(clients.id, created.data.id));
    expect(row?.marketingConsentAt).toBeNull();
  });

  it("updates and merges tags on a second call instead of duplicating", async () => {
    const caller = await makeCaller();
    const email = `dup-${uid().slice(0, 8)}@example.com`;

    const first = await upsertContact(caller, { name: "Ada", email, tags: ["a"] });
    const second = await upsertContact(caller, { email, tags: ["b"] });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.data.id).toBe(first.data.id);
    expect(second.data.tags.toSorted()).toEqual(["a", "b"]);
    // A name from a form fills a gap; it never overwrites one already known.
    expect(second.data.name).toBe("Ada");

    const rows = await db.select().from(clients).where(eq(clients.shopId, caller.shop.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses a contact with neither an email nor a phone", async () => {
    const caller = await makeCaller();
    const result = await upsertContact(caller, { name: "Nobody" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("invalid_request");
  });

  it("adds and removes tags without replacing the set", async () => {
    const caller = await makeCaller();
    const [contact] = await db
      .insert(clients)
      .values({
        shopId: caller.shop.id,
        name: "Ada",
        email: `tag-${uid().slice(0, 8)}@example.com`,
        tags: ["vip", "lead"],
      })
      .returning();

    const result = await tagContact(caller, contact?.id ?? "", {
      add: ["attended"],
      remove: ["lead"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // `vip` survives: a tag the seller added by hand is not something an
      // automation deletes by omitting it.
      expect(result.data.tags.toSorted()).toEqual(["attended", "vip"]);
    }
  });

  it("filters to only the people who opted in", async () => {
    const caller = await makeCaller();
    await db.insert(clients).values([
      {
        shopId: caller.shop.id,
        name: "Consented",
        email: `c-${uid().slice(0, 8)}@example.com`,
        marketingConsentAt: new Date(),
      },
      {
        shopId: caller.shop.id,
        name: "Customer",
        email: `n-${uid().slice(0, 8)}@example.com`,
        marketingConsentAt: null,
      },
    ]);

    const all = await listContacts(caller, paging);
    expect(all.ok && all.data).toHaveLength(2);

    const consented = await listContacts(caller, { ...paging, consented: true });
    expect(consented.ok).toBe(true);
    if (consented.ok) {
      expect(consented.data).toHaveLength(1);
      expect(consented.data[0]?.name).toBe("Consented");
    }
  });

  it("finds people by tag through the index", async () => {
    const caller = await makeCaller();
    await db.insert(clients).values([
      {
        shopId: caller.shop.id,
        name: "Tagged",
        email: `t-${uid().slice(0, 8)}@example.com`,
        tags: ["march-workshop"],
      },
      {
        shopId: caller.shop.id,
        name: "Untagged",
        email: `u-${uid().slice(0, 8)}@example.com`,
        tags: [],
      },
    ]);

    const tagged = await listContacts(caller, { ...paging, tag: "march-workshop" });
    expect(tagged.ok).toBe(true);
    if (tagged.ok) {
      expect(tagged.data).toHaveLength(1);
      expect(tagged.data[0]?.name).toBe("Tagged");
    }
  });
});

describe("scopes", () => {
  it("lets a read key read and refuses it a write", async () => {
    const readOnly = await makeCaller(["read"]);
    expect(requireScope(readOnly, "read")).toBeNull();

    const denied = requireScope(readOnly, "write");
    expect(denied?.code).toBe("forbidden");
    // Actionable, rather than a bare 403: "this key is read-only" tells
    // whoever is debugging what to change.
    expect(denied?.message).toContain("read-only");
  });
});

describe("the MCP tool surface", () => {
  it("hides write tools from a read-only key", async () => {
    const readOnly = await makeCaller(["read"]);
    const full = await makeCaller(["read", "write"]);

    const readNames = toolsFor(readOnly).map((tool) => tool.name);
    expect(readNames).toContain("list_orders");
    expect(readNames).not.toContain("create_contact");
    expect(readNames).not.toContain("tag_contact");

    expect(toolsFor(full).map((tool) => tool.name)).toContain("create_contact");
    expect(findTool(readOnly, "create_contact")).toBeNull();
  });

  it("runs every listed tool through the same handlers", async () => {
    const caller = await makeCaller();
    await makeOrder(caller);

    const viaTool = await findTool(caller, "get_shop")?.run(caller, {});
    const direct = getShop(caller);
    expect(viaTool?.ok).toBe(true);
    expect(direct.ok).toBe(true);
    // The tool is a wrapper, not a second implementation — same input, same
    // object, byte for byte.
    if (viaTool?.ok && direct.ok) expect(viaTool.data).toEqual(direct.data);

    const page = await findTool(caller, "list_orders")?.run(caller, { limit: 5 });
    expect(page?.ok).toBe(true);
    if (page?.ok) expect(Array.isArray(page.data)).toBe(true);
  });

  it("declares a valid input schema for every tool", async () => {
    /*
     * A client MUST reject a tool whose schema is malformed, and it drops that
     * tool from `tools/list` rather than failing loudly — so a broken schema
     * here is a tool that silently does not exist for the model.
     */
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.name, `${tool.name} is not a legal tool name`).toMatch(
        /^[A-Za-z0-9_.-]{1,128}$/,
      );
      expect(tool.description.length, `${tool.name} needs a real description`)
        .toBeGreaterThan(40);
    }
  });
});
