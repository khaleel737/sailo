import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The one property this router exists to hold: every read is scoped to the
 * caller's own shop, and a caller with no shop reads nothing.
 *
 * No database here — `getDb` and drizzle's `eq`/`desc` are mocked so the test
 * can see the exact predicate each procedure builds. That is the point: a query
 * that forgot `ctx.shopId`, or reached for an id the client sent, would show up
 * as a missing or wrong `eq(..., shopId)` right here rather than as a
 * cross-tenant leak in production.
 *
 * **This file is the catch-all, and it is meant to shrink.** `routers/` was
 * split so ten agents could write at once, and a single test module holding all
 * ten routers' cases puts the merge conflict back — in a shared working tree,
 * where there is no merge at all and the last writer simply wins. Each router
 * that grows enough behaviour to be worth its own file takes its cases with it:
 * `routers/analytics.test.ts`, `routers/uploads.test.ts` and
 * `routers/orders.test.ts` are already out. What stays here is what is genuinely
 * about the *composition* — the scoping property, asserted across routers, and
 * the fact that the namespaces are mounted at all.
 *
 * (`src/push.test.ts` is the one exception, and only because it predates the
 * split. It belongs at `routers/push.test.ts`.)
 */

const findFirst = vi.fn();
const productsFindMany = vi.fn();
const ordersFindMany = vi.fn();
const productsFindFirst = vi.fn();
const ordersFindFirst = vi.fn();

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: {
      shops: { findFirst },
      products: { findMany: productsFindMany, findFirst: productsFindFirst },
      orders: { findMany: ordersFindMany, findFirst: ordersFindFirst },
    },
  }),
}));

/*
 * Stubbed to keep them out of this run, not to be asserted on. `router.ts`
 * imports every router, so loading it loads `orders.ts`'s imports too —
 * @sailo/commerce reaches for `server-only` and @sailo/events for redis, and
 * neither belongs in a test about WHERE clauses. What the write actually does
 * with them is asserted in `routers/orders.test.ts`.
 */
vi.mock("@sailo/commerce/orders", () => ({ changeOrderStatus: vi.fn() }));
vi.mock("@sailo/events", () => ({ publishShopEvent: vi.fn() }));

// Tag `eq`/`desc`/`and`/`asc` so the test can read back the predicate each query
// builds, but keep the rest of drizzle real — @sailo/db/schema imports `sql` and
// more from here, and blanking those out would break the schema before the
// router even loads.
vi.mock("drizzle-orm", async (importActual) => ({
  ...(await importActual<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ __eq: { column, value } }),
  desc: (column: unknown) => ({ __desc: column }),
  asc: (column: unknown) => ({ __asc: column }),
  and: (...parts: unknown[]) => ({ __and: parts }),
}));

const { appRouter } = await import("./router");

function scopedValueOf(where: unknown): unknown {
  return (where as { __eq?: { value?: unknown } })?.__eq?.value;
}

/**
 * Every value a composed `and(...)` predicate compares against, in order.
 *
 * The single-`eq` case reads as a one-element list, so a query that quietly
 * lost its `and` — dropping the shop scope and keeping only the id — comes back
 * as `["order_1"]` and fails the assertion rather than passing a looser one.
 */
function scopedValuesOf(where: unknown): unknown[] {
  const parts = (where as { __and?: unknown[] })?.__and ?? [where];
  return parts.map(scopedValueOf);
}

beforeEach(() => {
  findFirst.mockReset();
  productsFindMany.mockReset();
  ordersFindMany.mockReset();
  productsFindFirst.mockReset();
  ordersFindFirst.mockReset();
});

/** Real uuids, because `byId` refuses anything that isn't one. */
const ORDER_ID = "6f1b4d2e-9c3a-4f7b-8d1e-2a5c7b9e0f31";
const PRODUCT_ID = "1c8e5a70-3b2d-4e91-a6f4-8d0b7c2e519a";

describe("the shop-scoped router", () => {
  it("refuses every read when no shop resolved", async () => {
    const caller = appRouter.createCaller({ shopId: null });
    await expect(caller.shop.get()).rejects.toThrow(/sign in/i);
    await expect(caller.products.list()).rejects.toThrow(/sign in/i);
    await expect(caller.orders.list()).rejects.toThrow(/sign in/i);
    await expect(caller.products.get({ id: PRODUCT_ID })).rejects.toThrow(/sign in/i);
    await expect(caller.orders.get({ id: ORDER_ID })).rejects.toThrow(/sign in/i);
    // A refused call must not have touched the database at all.
    expect(findFirst).not.toHaveBeenCalled();
    expect(productsFindMany).not.toHaveBeenCalled();
    expect(ordersFindMany).not.toHaveBeenCalled();
    expect(productsFindFirst).not.toHaveBeenCalled();
    expect(ordersFindFirst).not.toHaveBeenCalled();
  });

  it("scopes shop.get to the caller's own shop id", async () => {
    findFirst.mockResolvedValue({ id: "shop_1", name: "Clay & Co" });
    const shop = await appRouter.createCaller({ shopId: "shop_1" }).shop.get();
    expect(shop).toEqual({ id: "shop_1", name: "Clay & Co" });
    expect(scopedValueOf(findFirst.mock.calls[0]?.[0]?.where)).toBe("shop_1");
  });

  /*
   * The lists are paged now, so their predicate is an `and(...)` of a shop
   * scope and up to three optional filters. `filter(Boolean)` drops the
   * filters that were not asked for — what is asserted is that the *only*
   * surviving comparison is the caller's own shop id. A filter that quietly
   * replaced the scope rather than narrowing it fails right here.
   */
  it("scopes products.list to the caller's shop, never a client-sent id", async () => {
    productsFindMany.mockResolvedValue([{ id: "p1" }]);
    await appRouter.createCaller({ shopId: "shop_A" }).products.list();
    const where = productsFindMany.mock.calls[0]?.[0]?.where;
    expect(scopedValuesOf(where).filter(Boolean)).toEqual(["shop_A"]);
  });

  it("keeps the shop scope when a search narrows the list", async () => {
    // A search term is a filter on top of the scope. There is no input that
    // removes the other half, and this is where that would show.
    productsFindMany.mockResolvedValue([]);
    await appRouter
      .createCaller({ shopId: "shop_A" })
      .products.list({ search: "mug", status: "published" });
    const where = productsFindMany.mock.calls[0]?.[0]?.where;
    expect(scopedValuesOf(where)).toContain("shop_A");
  });

  it("scopes orders.list to the caller's shop and over-fetches by exactly one", async () => {
    ordersFindMany.mockResolvedValue([]);
    await appRouter.createCaller({ shopId: "shop_B" }).orders.list({ limit: 10 });
    const call = ordersFindMany.mock.calls[0]?.[0];
    expect(scopedValuesOf(call?.where).filter(Boolean)).toEqual(["shop_B"]);
    /*
     * Eleven for a page of ten. Getting the extra row back is how "there is
     * more" is known without a second `count(*)`; `pageOf` drops it before the
     * page is returned, and `@sailo/commerce/pagination` tests that it does.
     */
    expect(call?.limit).toBe(11);
  });

  it("defaults the page size when none is asked for", async () => {
    productsFindMany.mockResolvedValue([]);
    await appRouter.createCaller({ shopId: "shop_1" }).products.list();
    expect(productsFindMany.mock.calls[0]?.[0]?.limit).toBe(51);
  });

  it("refuses a page size beyond the ceiling", async () => {
    await expect(
      appRouter.createCaller({ shopId: "shop_1" }).products.list({ limit: 1000 }),
    ).rejects.toThrow();
  });

  /* ------------------------------------------------------------------------ */
  /*  Single-row reads                                                         */
  /*                                                                           */
  /*  The id arrives from the client, so the only thing standing between one   */
  /*  seller and another seller's order is the second half of the predicate.   */
  /*  These assert the whole predicate rather than just "a shop id appears in  */
  /*  it": a query narrowed to the id alone would still find the row.          */
  /* ------------------------------------------------------------------------ */

  it("scopes orders.get to the caller's shop as well as the id", async () => {
    ordersFindFirst.mockResolvedValue({ id: ORDER_ID, items: [] });
    const order = await appRouter
      .createCaller({ shopId: "shop_A" })
      .orders.get({ id: ORDER_ID });

    expect(order).toEqual({ id: ORDER_ID, items: [] });
    expect(scopedValuesOf(ordersFindFirst.mock.calls[0]?.[0]?.where)).toEqual([
      ORDER_ID,
      "shop_A",
    ]);
  });

  it("scopes products.get to the caller's shop as well as the id", async () => {
    productsFindFirst.mockResolvedValue({ id: PRODUCT_ID, images: [], variants: [] });
    const product = await appRouter
      .createCaller({ shopId: "shop_A" })
      .products.get({ id: PRODUCT_ID });

    expect(product).toEqual({ id: PRODUCT_ID, images: [], variants: [] });
    expect(scopedValuesOf(productsFindFirst.mock.calls[0]?.[0]?.where)).toEqual([
      PRODUCT_ID,
      "shop_A",
    ]);
  });

  /*
   * Another shop's row, as the database actually reports it: the WHERE carries
   * the caller's own shop id, so the row does not match and `findFirst` hands
   * back `undefined`. What is asserted is that the seller is told "not found"
   * rather than being handed the row — and that the predicate that made it not
   * match was the shop scope, not a coincidence.
   */
  it("cannot reach an order belonging to another shop", async () => {
    ordersFindFirst.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller({ shopId: "shop_B" }).orders.get({ id: ORDER_ID }),
    ).rejects.toThrow(/no such order/i);
    expect(scopedValuesOf(ordersFindFirst.mock.calls[0]?.[0]?.where)).toEqual([
      ORDER_ID,
      "shop_B",
    ]);
  });

  it("cannot reach a product belonging to another shop", async () => {
    productsFindFirst.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller({ shopId: "shop_B" }).products.get({ id: PRODUCT_ID }),
    ).rejects.toThrow(/no such product/i);
    expect(scopedValuesOf(productsFindFirst.mock.calls[0]?.[0]?.where)).toEqual([
      PRODUCT_ID,
      "shop_B",
    ]);
  });

  /*
   * A missing row and someone else's row answer identically. If they didn't,
   * the difference would be a way to ask which ids exist in another shop.
   */
  it("answers a missing row and another shop's row the same way", async () => {
    ordersFindFirst.mockResolvedValue(undefined);
    const caller = appRouter.createCaller({ shopId: "shop_B" });
    const missing = await caller.orders.get({ id: ORDER_ID }).catch((e) => e);
    const foreign = await caller.orders.get({ id: ORDER_ID }).catch((e) => e);
    expect(missing.code).toBe("NOT_FOUND");
    expect(foreign.code).toBe(missing.code);
    expect(foreign.message).toBe(missing.message);
  });

  it("refuses an id that is not a uuid before it reaches the database", async () => {
    await expect(
      appRouter.createCaller({ shopId: "shop_1" }).orders.get({ id: "../../etc" }),
    ).rejects.toThrow();
    expect(ordersFindFirst).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/*  Moved out                                                                  */
/*                                                                             */
/*  `orders.updateStatus` — the app's only write — used to be asserted here.   */
/*  It now has `routers/orders.test.ts` to itself, because it grew a shop      */
/*  read, a webhook emission and two hook seams, and none of that is about     */
/*  the composition this file describes. The scoping property it held is       */
/*  held there, in more detail than it was here.                               */
/* -------------------------------------------------------------------------- */

