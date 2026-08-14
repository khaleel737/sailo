import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_STATUSES } from "@sailo/core/order-status";

/**
 * The app's first write, and the two things that have to be true of it.
 *
 * **It lands in the caller's own shop.** A write is where a missing scope stops
 * being a leak and becomes damage: the order id comes from the client, so
 * without `ctx.shopId` in the call a seller could cancel — and restock, and
 * void the tickets of — an order belonging to somebody else's shop.
 *
 * **Everyone who has to hear about it does.** This is the half that was wrong
 * in production. The status change worked; the `order.cancelled` webhook behind
 * it did not fire, because the emission had been written at the one call site
 * that had Next's `after()` to hand. A seller's Zap ran when they used a
 * browser and did not when they used their thumb, and nothing anywhere said so.
 * The assertions about `changeOrderStatus`'s second argument are what keep that
 * closed.
 *
 * `changeOrderStatus` itself is stubbed. What it does — the cascade, the
 * webhooks, the transition guards — is @sailo/commerce's and is tested there
 * against its own source; mocking it keeps that boundary honest and keeps
 * `server-only` out of this test run.
 *
 * Split out of `src/router.test.ts` and mounted alone, for the reason
 * `analytics.test.ts` gives: `routers/` exists so one file can be worked on
 * without the other nine in the way, and a test that loads all ten gives that
 * up. Nothing is lost — `shopProcedure` is the same middleware either way, and
 * that the namespace is on the composed router is `router.ts`'s property,
 * asserted beside the composition itself.
 */

const shopsFindFirst = vi.fn();

vi.mock("@sailo/db", () => ({
  // Only the shop read. `list` and `get` are read-only and are covered beside
  // the other routers' reads in `src/router.test.ts`.
  getDb: () => ({ query: { shops: { findFirst: shopsFindFirst } } }),
}));

const changeOrderStatus = vi.fn();
vi.mock("@sailo/commerce/orders", () => ({ changeOrderStatus }));

const publishShopEvent = vi.fn();
vi.mock("@sailo/events", () => ({ publishShopEvent }));

// Tagged the way `router.test.ts` tags them, so the predicate the shop lookup
// builds can be read back — a lookup that took an id from the client rather
// than from the context would show up right here.
vi.mock("drizzle-orm", async (importActual) => ({
  ...(await importActual<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ __eq: { column, value } }),
  desc: (column: unknown) => ({ __desc: column }),
  asc: (column: unknown) => ({ __asc: column }),
  and: (...parts: unknown[]) => ({ __and: parts }),
}));

const { router } = await import("../trpc");
const { ordersRouter } = await import("./orders");
const appRouter = router({ orders: ordersRouter });

function scopedValueOf(where: unknown): unknown {
  return (where as { __eq?: { value?: unknown } })?.__eq?.value;
}

/** A real uuid, because `byId` refuses anything that isn't one. */
const ORDER_ID = "6f1b4d2e-9c3a-4f7b-8d1e-2a5c7b9e0f31";

/** The row the lookup returns — enough of a shop to gate a plan and address an envelope. */
const SHOP_A = { id: "shop_A", handle: "acme", plan: "business" };

const change = {
  previous: { id: ORDER_ID, status: "new" },
  status: "confirmed",
  restocked: false,
  retaken: false,
  transition: { answeredBooking: false, bookingAccepted: true, justCancelled: false },
};

beforeEach(() => {
  shopsFindFirst.mockReset().mockResolvedValue(SHOP_A);
  changeOrderStatus.mockReset().mockResolvedValue(change);
  publishShopEvent.mockReset();
});

describe("orders.updateStatus", () => {
  it("refuses the write when no shop resolved", async () => {
    await expect(
      appRouter
        .createCaller({ shopId: null })
        .orders.updateStatus({ id: ORDER_ID, status: "confirmed" }),
    ).rejects.toThrow(/sign in/i);
    // Nothing may reach the database or the shared cascade on a refused call.
    expect(shopsFindFirst).not.toHaveBeenCalled();
    expect(changeOrderStatus).not.toHaveBeenCalled();
    expect(publishShopEvent).not.toHaveBeenCalled();
  });

  it("reads the shop row by the caller's own id, never one the client sent", async () => {
    await appRouter
      .createCaller({ shopId: "shop_A" })
      .orders.updateStatus({ id: ORDER_ID, status: "confirmed" });
    expect(scopedValueOf(shopsFindFirst.mock.calls[0]?.[0]?.where)).toBe("shop_A");
  });

  it("applies the change against the caller's own shop", async () => {
    const result = await appRouter
      .createCaller({ shopId: "shop_A" })
      .orders.updateStatus({ id: ORDER_ID, status: "confirmed" });

    // One argument and no second one — `toHaveBeenCalledWith` asserts the whole
    // list, so a `hooks` object appearing later fails here. See below for why.
    expect(changeOrderStatus).toHaveBeenCalledWith({
      shop: SHOP_A,
      orderId: ORDER_ID,
      status: "confirmed",
    });
    expect(result).toEqual({ id: ORDER_ID, status: "confirmed" });
  });

  /*
   * The row itself, not an id it could have rebuilt from `ctx.shopId`.
   *
   * The webhook's plan gate reads this shop's billing and its envelope carries
   * this shop's handle. A stub assembled here — `{ id: ctx.shopId }` — would
   * emit a payload that differs from the web app's for the same event, and the
   * consumer receiving it could tell which surface the seller was holding.
   */
  it("hands the package the shop row it read", async () => {
    await appRouter
      .createCaller({ shopId: "shop_A" })
      .orders.updateStatus({ id: ORDER_ID, status: "confirmed" });
    expect(changeOrderStatus.mock.calls[0]?.[0]?.shop).toBe(SHOP_A);
  });

  /*
   * The production bug, pinned.
   *
   * `changeOrderStatus` emits the webhooks itself and awaits them when it is
   * given no scheduler. Handing it a `defer` here would be handing it one that
   * does not exist off-server: this process may return its response and be
   * frozen before a deferred task ever ran, and the emission would be lost
   * exactly as silently as it was when it was never written at all.
   */
  it("hands the package no scheduler, so the emission is awaited", async () => {
    await appRouter
      .createCaller({ shopId: "shop_A" })
      .orders.updateStatus({ id: ORDER_ID, status: "confirmed" });
    expect(changeOrderStatus.mock.calls[0]?.[1]?.defer).toBeUndefined();
  });

  /*
   * And no `revalidate`. There is no Next request scope here and no page of the
   * seller's that this process caches — a callback would be this app claiming
   * to have dropped a cache it does not own.
   */
  it("revalidates nothing, because it caches nothing", async () => {
    await appRouter
      .createCaller({ shopId: "shop_A" })
      .orders.updateStatus({ id: ORDER_ID, status: "confirmed" });
    expect(changeOrderStatus.mock.calls[0]?.[1]?.revalidate).toBeUndefined();
  });

  /*
   * The ownership test. `changeOrderStatus` scopes its own WHERE to the shop it
   * is handed and answers null when nothing matched — so a row in another shop
   * is refused, and the caller is told the same "no such order" a missing row
   * gets.
   */
  it("cannot write to an order belonging to another shop", async () => {
    shopsFindFirst.mockResolvedValue({ ...SHOP_A, id: "shop_B" });
    changeOrderStatus.mockResolvedValue(null);
    await expect(
      appRouter
        .createCaller({ shopId: "shop_B" })
        .orders.updateStatus({ id: ORDER_ID, status: "cancelled" }),
    ).rejects.toThrow(/no such order/i);

    // And it was the caller's own shop that was used to look, not an id the
    // client sent — there is no shopId in the input schema to send.
    expect(changeOrderStatus.mock.calls[0]?.[0]?.shop.id).toBe("shop_B");
  });

  it("answers NOT_FOUND when the shop row itself is gone", async () => {
    shopsFindFirst.mockResolvedValue(undefined);
    await expect(
      appRouter
        .createCaller({ shopId: "shop_A" })
        .orders.updateStatus({ id: ORDER_ID, status: "confirmed" }),
    ).rejects.toThrow(/no such shop/i);
    // A shop that no longer exists must not reach a write at all.
    expect(changeOrderStatus).not.toHaveBeenCalled();
  });

  it("does not announce a change that did not happen", async () => {
    changeOrderStatus.mockResolvedValue(null);
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
    expect(changeOrderStatus).not.toHaveBeenCalled();
  });

  it("accepts every status the shared list declares", async () => {
    const caller = appRouter.createCaller({ shopId: "shop_A" });
    for (const status of ORDER_STATUSES) {
      await expect(
        caller.orders.updateStatus({ id: ORDER_ID, status }),
      ).resolves.toBeTruthy();
    }
    expect(changeOrderStatus).toHaveBeenCalledTimes(ORDER_STATUSES.length);
  });
});
