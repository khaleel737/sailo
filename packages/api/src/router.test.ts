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
 */

const findFirst = vi.fn();
const productsFindMany = vi.fn();
const ordersFindMany = vi.fn();

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: {
      shops: { findFirst },
      products: { findMany: productsFindMany },
      orders: { findMany: ordersFindMany },
    },
  }),
}));

// Tag `eq`/`desc` so the test can read back the predicate each query builds,
// but keep the rest of drizzle real — @sailo/db/schema imports `sql` and more
// from here, and blanking those out would break the schema before the router
// even loads.
vi.mock("drizzle-orm", async (importActual) => ({
  ...(await importActual<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ __eq: { column, value } }),
  desc: (column: unknown) => ({ __desc: column }),
}));

const { appRouter } = await import("./router");

function scopedValueOf(where: unknown): unknown {
  return (where as { __eq?: { value?: unknown } })?.__eq?.value;
}

beforeEach(() => {
  findFirst.mockReset();
  productsFindMany.mockReset();
  ordersFindMany.mockReset();
});

describe("the shop-scoped router", () => {
  it("refuses every read when no shop resolved", async () => {
    const caller = appRouter.createCaller({ shopId: null });
    await expect(caller.shop.get()).rejects.toThrow(/sign in/i);
    await expect(caller.products.list()).rejects.toThrow(/sign in/i);
    await expect(caller.orders.list()).rejects.toThrow(/sign in/i);
    // A refused call must not have touched the database at all.
    expect(findFirst).not.toHaveBeenCalled();
    expect(productsFindMany).not.toHaveBeenCalled();
    expect(ordersFindMany).not.toHaveBeenCalled();
  });

  it("scopes shop.get to the caller's own shop id", async () => {
    findFirst.mockResolvedValue({ id: "shop_1", name: "Clay & Co" });
    const shop = await appRouter.createCaller({ shopId: "shop_1" }).shop.get();
    expect(shop).toEqual({ id: "shop_1", name: "Clay & Co" });
    expect(scopedValueOf(findFirst.mock.calls[0]?.[0]?.where)).toBe("shop_1");
  });

  it("scopes products.list to the caller's shop, never a client-sent id", async () => {
    productsFindMany.mockResolvedValue([{ id: "p1" }]);
    await appRouter.createCaller({ shopId: "shop_A" }).products.list();
    expect(scopedValueOf(productsFindMany.mock.calls[0]?.[0]?.where)).toBe("shop_A");
  });

  it("scopes orders.list to the caller's shop and clamps the limit", async () => {
    ordersFindMany.mockResolvedValue([]);
    await appRouter.createCaller({ shopId: "shop_B" }).orders.list({ limit: 10 });
    const call = ordersFindMany.mock.calls[0]?.[0];
    expect(scopedValueOf(call?.where)).toBe("shop_B");
    expect(call?.limit).toBe(10);
  });

  it("defaults the page size when none is asked for", async () => {
    productsFindMany.mockResolvedValue([]);
    await appRouter.createCaller({ shopId: "shop_1" }).products.list();
    expect(productsFindMany.mock.calls[0]?.[0]?.limit).toBe(50);
  });

  it("refuses a page size beyond the ceiling", async () => {
    await expect(
      appRouter.createCaller({ shopId: "shop_1" }).products.list({ limit: 1000 }),
    ).rejects.toThrow();
  });
});
