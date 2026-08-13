import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORDER_STATUSES } from "@sailo/core/order-status";

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

/**
 * The shared status change, stubbed.
 *
 * What this router is responsible for is *which shop* the change is applied
 * to — the cascade itself (units back on the shelf, tickets voided) is
 * @sailo/commerce's, and is tested there against its own source. Mocking it
 * keeps that boundary honest and keeps `server-only` out of this test run.
 */
const applyOrderStatus = vi.fn();
vi.mock("@sailo/commerce/orders", () => ({ applyOrderStatus }));

const publishShopEvent = vi.fn();
vi.mock("@sailo/events", () => ({ publishShopEvent }));

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
  applyOrderStatus.mockReset();
  publishShopEvent.mockReset();
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

  /* ------------------------------------------------------------------------ */
  /*  The first mutation                                                       */
  /*                                                                           */
  /*  A write is where a missing shop scope stops being a leak and becomes     */
  /*  damage: the id comes from the client, so without `ctx.shopId` in the     */
  /*  call a seller could cancel — and restock, and void the tickets of — an   */
  /*  order belonging to somebody else's shop.                                 */
  /* ------------------------------------------------------------------------ */

  describe("orders.updateStatus", () => {
    const change = { previous: { id: ORDER_ID, status: "new" }, status: "confirmed" };

    it("refuses the write when no shop resolved", async () => {
      await expect(
        appRouter
          .createCaller({ shopId: null })
          .orders.updateStatus({ id: ORDER_ID, status: "confirmed" }),
      ).rejects.toThrow(/sign in/i);
      // Nothing may reach the shared cascade on a refused call.
      expect(applyOrderStatus).not.toHaveBeenCalled();
      expect(publishShopEvent).not.toHaveBeenCalled();
    });

    it("applies the change against the caller's own shop", async () => {
      applyOrderStatus.mockResolvedValue(change);
      const result = await appRouter
        .createCaller({ shopId: "shop_A" })
        .orders.updateStatus({ id: ORDER_ID, status: "confirmed" });

      expect(applyOrderStatus).toHaveBeenCalledWith({
        shopId: "shop_A",
        orderId: ORDER_ID,
        status: "confirmed",
      });
      expect(result).toEqual({ id: ORDER_ID, status: "confirmed" });
    });

    /*
     * The ownership test. `applyOrderStatus` scopes its own WHERE to the shop
     * id it is handed and answers null when nothing matched — so a row in
     * another shop is refused, and the caller is told the same "no such order"
     * a missing row gets.
     */
    it("cannot write to an order belonging to another shop", async () => {
      applyOrderStatus.mockResolvedValue(null);
      await expect(
        appRouter
          .createCaller({ shopId: "shop_B" })
          .orders.updateStatus({ id: ORDER_ID, status: "cancelled" }),
      ).rejects.toThrow(/no such order/i);

      // And it was the caller's own shop that was used to look, not an id the
      // client sent — there is no shopId in the input schema to send.
      expect(applyOrderStatus).toHaveBeenCalledWith({
        shopId: "shop_B",
        orderId: ORDER_ID,
        status: "cancelled",
      });
    });

    it("does not announce a change that did not happen", async () => {
      applyOrderStatus.mockResolvedValue(null);
      await expect(
        appRouter
          .createCaller({ shopId: "shop_B" })
          .orders.updateStatus({ id: ORDER_ID, status: "cancelled" }),
      ).rejects.toThrow();
      // A publish on a refused write wakes every other screen to re-read
      // nothing, and on the staff panel it reads as an order that moved.
      expect(publishShopEvent).not.toHaveBeenCalled();
    });

    it("tells the shop's other screens once the write lands", async () => {
      applyOrderStatus.mockResolvedValue(change);
      await appRouter
        .createCaller({ shopId: "shop_A" })
        .orders.updateStatus({ id: ORDER_ID, status: "confirmed" });
      expect(publishShopEvent).toHaveBeenCalledWith("shop_A", "order");
    });

    it("refuses a status the system cannot store", async () => {
      await expect(
        appRouter
          .createCaller({ shopId: "shop_A" })
          // @ts-expect-error — the enum is the point; this is what a
          // hand-rolled POST sends, and it must not reach the cascade.
          .orders.updateStatus({ id: ORDER_ID, status: "deleted" }),
      ).rejects.toThrow();
      expect(applyOrderStatus).not.toHaveBeenCalled();
    });

    it("accepts every status the shared list declares", async () => {
      applyOrderStatus.mockResolvedValue(change);
      const caller = appRouter.createCaller({ shopId: "shop_A" });
      for (const status of ORDER_STATUSES) {
        await expect(
          caller.orders.updateStatus({ id: ORDER_ID, status }),
        ).resolves.toBeTruthy();
      }
      expect(applyOrderStatus).toHaveBeenCalledTimes(ORDER_STATUSES.length);
    });
  });
});
