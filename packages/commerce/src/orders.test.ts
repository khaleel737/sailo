import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_STATUSES } from "@sailo/core/order-status";
import type { Order, Shop } from "@sailo/db/schema";

/**
 * A status change and everyone who is told about it.
 *
 * This is the file that would have caught the bug it was written for. Both the
 * web admin and the mobile API change order statuses; only the web admin fired
 * the webhooks behind them, because the emission had been written where Next's
 * `after()` was to hand. A seller's Zap ran for a click and not for a tap, and
 * the failure was completely silent — the order moved, the seller saw it move,
 * and the thing that did not happen left no trace anywhere.
 *
 * So the rules are tested here, once, in the package both surfaces call, rather
 * than at either call site. `orderTransition` is a plain function and is
 * exhausted over the whole status list; `changeOrderStatus` is exercised with
 * its database and its emitter stubbed, because what is being asserted is which
 * announcements a given transition owes, not what the queue does with them.
 */

const ordersFindFirst = vi.fn();
const setWhere = vi.fn();

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: { orders: { findFirst: ordersFindFirst } },
    update: () => ({ set: () => ({ where: setWhere }) }),
  }),
}));

const restoreStock = vi.fn();
const retakeStock = vi.fn();
vi.mock("./inventory", async (importActual) => ({
  // `isStockReleasingStatus` stays real — it is the rule deciding which branch
  // runs, and stubbing it would leave this test asserting its own mock.
  ...(await importActual<typeof import("./inventory")>()),
  restoreStock,
  retakeStock,
}));

vi.mock("./tickets", () => ({
  voidTicketsForOrder: vi.fn(),
  reinstateTicketsForOrder: vi.fn(),
}));

const emitOrderWebhook = vi.fn();
vi.mock("./webhooks", () => ({ emitOrderWebhook }));

const { changeOrderStatus, orderTransition } = await import("./orders");

const SHOP = { id: "shop_A", handle: "acme" } as Shop;
const ORDER_ID = "order_1";

/** The row as it read *before* the write — every guard here asks about that. */
function previousOrder(fields: Partial<Order>): Order {
  return {
    id: ORDER_ID,
    shopId: SHOP.id,
    status: "new",
    scheduledFor: null,
    restockedAt: null,
    affiliateId: null,
    ...fields,
  } as Order;
}

/** Events actually emitted, in order, once every deferred task has run. */
let emitted: string[];
let deferred: (() => Promise<void>)[];

beforeEach(() => {
  emitted = [];
  deferred = [];
  ordersFindFirst.mockReset();
  setWhere.mockReset().mockResolvedValue(undefined);
  restoreStock.mockReset().mockResolvedValue(false);
  retakeStock.mockReset().mockResolvedValue(false);
  emitOrderWebhook.mockReset().mockImplementation(async (opts: { event: string }) => {
    // A real tick, so "was it awaited" is a question with a wrong answer.
    await Promise.resolve();
    emitted.push(opts.event);
  });
});

/* -------------------------------------------------------------------------- */
/*  The rule                                                                   */
/* -------------------------------------------------------------------------- */

describe("orderTransition", () => {
  it("calls a cancellation a cancellation exactly once", () => {
    expect(orderTransition({ scheduledFor: null, status: "new" }, "cancelled"))
      .toMatchObject({ justCancelled: true });
    // The seller re-saving a dropdown that already said cancelled has changed
    // nothing. Firing again is how a buyer is told four times.
    expect(orderTransition({ scheduledFor: null, status: "cancelled" }, "cancelled"))
      .toMatchObject({ justCancelled: false });
  });

  it("only answers a booking that was still waiting", () => {
    const when = new Date("2026-09-01T18:00:00Z");

    // A booked order stays `new` through payment, so moving it off `new` is
    // the seller answering.
    expect(orderTransition({ scheduledFor: when, status: "new" }, "confirmed"))
      .toMatchObject({ answeredBooking: true, bookingAccepted: true });
    expect(orderTransition({ scheduledFor: when, status: "new" }, "cancelled"))
      .toMatchObject({ answeredBooking: true, bookingAccepted: false });

    // Already answered — the seller is tidying, not deciding.
    expect(orderTransition({ scheduledFor: when, status: "confirmed" }, "completed"))
      .toMatchObject({ answeredBooking: false });
    // And staying put is not an answer at all.
    expect(orderTransition({ scheduledFor: when, status: "new" }, "new"))
      .toMatchObject({ answeredBooking: false });
  });

  it("never calls an ordinary order a booking", () => {
    /*
     * Exhaustive, because `scheduledFor` is the only thing separating the two
     * and a rule that leaked would email every buyer of a t-shirt about an
     * appointment they never made.
     */
    for (const status of ORDER_STATUSES) {
      expect(
        orderTransition({ scheduledFor: null, status: "new" }, status).answeredBooking,
        status,
      ).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  The announcements                                                          */
/* -------------------------------------------------------------------------- */

describe("changeOrderStatus", () => {
  it("emits order.cancelled when the seller cancels", async () => {
    ordersFindFirst.mockResolvedValue(previousOrder({ status: "new" }));
    await changeOrderStatus({ shop: SHOP, orderId: ORDER_ID, status: "cancelled" });

    expect(emitted).toEqual(["order.cancelled"]);
    expect(emitOrderWebhook).toHaveBeenCalledWith({
      shop: SHOP,
      event: "order.cancelled",
      orderId: ORDER_ID,
    });
  });

  it("says nothing when the seller re-saves a cancelled order", async () => {
    ordersFindFirst.mockResolvedValue(previousOrder({ status: "cancelled" }));
    await changeOrderStatus({ shop: SHOP, orderId: ORDER_ID, status: "cancelled" });
    expect(emitted).toEqual([]);
  });

  it("emits booking.confirmed when the seller accepts an appointment", async () => {
    ordersFindFirst.mockResolvedValue(
      previousOrder({ status: "new", scheduledFor: new Date("2026-09-01T18:00:00Z") }),
    );
    await changeOrderStatus({ shop: SHOP, orderId: ORDER_ID, status: "confirmed" });
    expect(emitted).toEqual(["booking.confirmed"]);
  });

  it("calls a declined booking a cancellation and not a confirmation", async () => {
    /*
     * One event per thing that happened. A decline is already an
     * `order.cancelled`, and a consumer receiving `booking.confirmed` beside it
     * would have been told both that the appointment was agreed and that it was
     * called off.
     */
    ordersFindFirst.mockResolvedValue(
      previousOrder({ status: "new", scheduledFor: new Date("2026-09-01T18:00:00Z") }),
    );
    await changeOrderStatus({ shop: SHOP, orderId: ORDER_ID, status: "cancelled" });
    expect(emitted).toEqual(["order.cancelled"]);
  });

  it("emits nothing for an ordinary status the catalogue has no event for", async () => {
    ordersFindFirst.mockResolvedValue(previousOrder({ status: "new" }));
    await changeOrderStatus({ shop: SHOP, orderId: ORDER_ID, status: "confirmed" });
    expect(emitted).toEqual([]);
  });

  /*
   * The production bug, as a behaviour rather than as a shape.
   *
   * A caller with no scheduler — which is `apps/api`, which is the phone — must
   * have the emission complete before this resolves. Deferring it to a
   * `setTimeout` nobody awaits in a process that may be frozen the moment it
   * responds is the same silence the bug had, arrived at a different way.
   */
  it("awaits the emission when the caller hands it no scheduler", async () => {
    ordersFindFirst.mockResolvedValue(previousOrder({ status: "new" }));
    await changeOrderStatus({ shop: SHOP, orderId: ORDER_ID, status: "cancelled" });
    expect(emitted).toEqual(["order.cancelled"]);
  });

  it("hands the emission to a scheduler when the caller has one", async () => {
    ordersFindFirst.mockResolvedValue(previousOrder({ status: "new" }));
    await changeOrderStatus(
      { shop: SHOP, orderId: ORDER_ID, status: "cancelled" },
      { defer: (task) => deferred.push(task) },
    );

    // Off the seller's click, exactly as `after()` puts it.
    expect(emitted).toEqual([]);
    expect(deferred).toHaveLength(1);

    for (const task of deferred) await task();
    expect(emitted).toEqual(["order.cancelled"]);
  });

  it("drops the caller's cache once, whatever the transition was", async () => {
    const revalidate = vi.fn();
    ordersFindFirst.mockResolvedValue(previousOrder({ status: "new" }));
    await changeOrderStatus(
      { shop: SHOP, orderId: ORDER_ID, status: "confirmed" },
      { revalidate },
    );
    // Called even though this transition emitted nothing — the seller's own
    // orders list has changed either way, and that is what it invalidates.
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("announces nothing about an order that is not this shop's", async () => {
    /*
     * `applyOrderStatus` scopes its own WHERE and answers undefined when
     * nothing matched, so this is what a seller poking at another shop's order
     * id reaches. Emitting here would describe a stranger's order to this
     * shop's endpoint, which is the worst thing this feature could do.
     */
    const revalidate = vi.fn();
    ordersFindFirst.mockResolvedValue(undefined);
    const result = await changeOrderStatus(
      { shop: SHOP, orderId: ORDER_ID, status: "cancelled" },
      { revalidate },
    );

    expect(result).toBeNull();
    expect(emitted).toEqual([]);
    expect(revalidate).not.toHaveBeenCalled();
    expect(setWhere).not.toHaveBeenCalled();
  });

  it("hands back the transition it decided on, so a caller cannot re-derive it", () => {
    /*
     * `apps/web` still owns the buyer's booking email — `sendBookingDecision`
     * lives in a module that owns Resend and the HTML layout, and extracting it
     * is `packages/email`'s job. Returning the decision rather than making the
     * action work it out again is what stops the email and the
     * `booking.confirmed` webhook drifting apart in the meantime.
     */
    ordersFindFirst.mockResolvedValue(
      previousOrder({ status: "new", scheduledFor: new Date("2026-09-01T18:00:00Z") }),
    );
    return expect(
      changeOrderStatus({ shop: SHOP, orderId: ORDER_ID, status: "confirmed" }),
    ).resolves.toMatchObject({
      transition: { answeredBooking: true, bookingAccepted: true },
    });
  });
});
