import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Shop } from "@sailo/db/schema";

/**
 * Telling the seller something happened in their shop.
 *
 * WHY THIS FILE EXISTS
 *
 * `packages/workflows` had nine modules and no tests, and its `package.json` said
 * `vitest run --passWithNoTests` — so the layer that decides whether a seller is
 * told about an order at all reported green on every run without executing a line.
 *
 * What it decides is not incidental. A seller standing at a market stall finds out
 * they have an order because this function chose to tell them, and every branch
 * below is a way for that not to happen: a preference read wrong, a rate limit that
 * counts the wrong thing, a missing contact email taking the push down with the
 * mail, or a mail provider's bad afternoon throwing into the caller that just took
 * the money.
 */

const ordersFindFirst = vi.fn();
const itemsFindMany = vi.fn();
const userFindFirst = vi.fn();
const rateLimit = vi.fn();
const wantsNotification = vi.fn();
const pushSellerOrder = vi.fn();
const sendSellerOrderPlaced = vi.fn();
const sendSellerBookingRequested = vi.fn();
const sendSellerOrderNeedsAction = vi.fn();

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: {
      orders: { findFirst: ordersFindFirst },
      orderItems: { findMany: itemsFindMany },
      user: { findFirst: userFindFirst },
    },
  }),
}));
vi.mock("@sailo/rate-limit", () => ({ rateLimit }));
vi.mock("@sailo/notifications/prefs", () => ({ wantsNotification }));
vi.mock("@sailo/notifications/push", () => ({ pushSellerOrder }));
vi.mock("@sailo/email/shop", () => ({
  sendSellerOrderPlaced,
  sendSellerBookingRequested,
  sendSellerOrderNeedsAction,
}));

const { notifySellerOfOrder, notifySellerOfPaymentReport } = await import("./notify-seller");

/*
 * `notificationPrefs: {}` rather than `null`, because that is what the column can
 * actually hold: it is `jsonb().notNull().default({})`, and the schema's own comment
 * says the absence of a key is opt-in so new event types need no backfill. A fixture
 * using `null` would be testing a state the database cannot produce — and it does not
 * typecheck, which is how this was caught.
 */
const SHOP = {
  id: "shop-1",
  userId: "user-1",
  contactEmail: "seller@example.com",
  notificationPrefs: {},
} as Shop;

const ORDER = { id: "order-1", scheduledFor: null };

beforeEach(() => {
  vi.clearAllMocks();
  ordersFindFirst.mockResolvedValue(ORDER);
  itemsFindMany.mockResolvedValue([{ id: "item-1", position: 0 }]);
  userFindFirst.mockResolvedValue({ email: "account@example.com" });
  rateLimit.mockResolvedValue({ allowed: true });
  /*
   * An explicit default, because `clearAllMocks` clears call history and leaves
   * implementations in place — so without this a rejection set by one test leaks
   * into the next, and the leak is invisible: the workflow catches it and returns
   * early, so the next test simply observes nothing happening.
   */
  pushSellerOrder.mockResolvedValue(undefined);
  wantsNotification.mockReturnValue(true);
  sendSellerOrderPlaced.mockResolvedValue({ sent: true });
  sendSellerBookingRequested.mockResolvedValue({ sent: true });
  sendSellerOrderNeedsAction.mockResolvedValue({ sent: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("an order the seller should hear about", () => {
  it("emails the seller and pushes to their phone", async () => {
    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(sendSellerOrderPlaced).toHaveBeenCalledOnce();
    expect(pushSellerOrder).toHaveBeenCalledOnce();
  });

  /*
   * Read back from the database rather than trusting the caller's draft — the row
   * is what the seller will find in their admin, and a caller that passes a draft
   * it has not committed would have the mail describe an order that does not exist.
   */
  it("reads the order back rather than trusting the caller", async () => {
    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(ordersFindFirst).toHaveBeenCalledOnce();
  });

  it("says nothing when the order is not there", async () => {
    ordersFindFirst.mockResolvedValue(undefined);

    await notifySellerOfOrder({ shop: SHOP, orderId: "gone" });

    expect(sendSellerOrderPlaced).not.toHaveBeenCalled();
    expect(pushSellerOrder).not.toHaveBeenCalled();
  });
});

describe("an order carrying an appointment", () => {
  /*
   * The seller's next move on a booking is accept or decline, not fulfil. Sending
   * both mails is how a seller learns to ignore both, so this is an *instead*.
   */
  it("sends the booking mail instead of the order mail", async () => {
    ordersFindFirst.mockResolvedValue({ ...ORDER, scheduledFor: "2026-09-01T10:00:00Z" });

    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(sendSellerBookingRequested).toHaveBeenCalledOnce();
    expect(sendSellerOrderPlaced).not.toHaveBeenCalled();
  });

  it("asks about the booking preference, not the order one", async () => {
    ordersFindFirst.mockResolvedValue({ ...ORDER, scheduledFor: "2026-09-01T10:00:00Z" });

    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(wantsNotification).toHaveBeenCalledWith(SHOP.notificationPrefs, "bookingRequested");
  });

  it("tells the push which kind it is, so the two channels agree", async () => {
    ordersFindFirst.mockResolvedValue({ ...ORDER, scheduledFor: "2026-09-01T10:00:00Z" });

    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(pushSellerOrder).toHaveBeenCalledWith(expect.objectContaining({ booking: true }));
  });
});

describe("the preference switch", () => {
  /*
   * One switch, both channels. It means "tell me when an order is placed", not
   * "email me" — so a seller who turned it off has said no to being told, and a
   * push that ignored it would be the shop shouting from a channel they muted.
   */
  it("silences the mail and the push together", async () => {
    wantsNotification.mockReturnValue(false);

    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(sendSellerOrderPlaced).not.toHaveBeenCalled();
    expect(pushSellerOrder).not.toHaveBeenCalled();
  });

  it("treats an absent key as consent, because a new shop has set nothing", async () => {
    // A shop that has never touched the switches has `{}`, and the real
    // `wantsNotification` reads a missing key as opt-in. This pins that the workflow
    // delegates that reading rather than interpreting the column itself.
    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(wantsNotification).toHaveBeenCalledWith({}, "orderPlaced");
  });
});

describe("the daily ceiling", () => {
  it("counts per shop per day, not per order", async () => {
    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(rateLimit).toHaveBeenCalledWith("seller-mail:shop-1", 500, 86_400);
  });

  /*
   * The ceiling exists so a bug or an order bomb cannot burn the sending quota. It
   * has to stop the push too: a second channel with its own allowance is its own
   * way to notify a seller five hundred times.
   */
  it("stops both channels once it is hit", async () => {
    rateLimit.mockResolvedValue({ allowed: false });

    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(sendSellerOrderPlaced).not.toHaveBeenCalled();
    expect(pushSellerOrder).not.toHaveBeenCalled();
  });

  /*
   * A fresh shop id, because `ceilingLogged` is module-level and deliberately
   * never reset — it is a per-instance log-noise guard, so a shop another test in
   * this file already tripped would report nothing here and the assertion would
   * pass for the wrong reason.
   */
  it("logs a hit shop once rather than once per suppressed order", async () => {
    rateLimit.mockResolvedValue({ allowed: false });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const noisy = { ...SHOP, id: "shop-noisy" } as Shop;

    await notifySellerOfOrder({ shop: noisy, orderId: "a" });
    await notifySellerOfOrder({ shop: noisy, orderId: "b" });
    await notifySellerOfOrder({ shop: noisy, orderId: "c" });

    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("where the mail goes", () => {
  it("prefers the shop's contact address", async () => {
    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(sendSellerOrderPlaced).toHaveBeenCalledWith(
      expect.objectContaining({ to: "seller@example.com" }),
    );
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it("falls back to the account's own email when the shop set none", async () => {
    const shop = { ...SHOP, contactEmail: null } as Shop;

    await notifySellerOfOrder({ shop, orderId: "order-1" });

    expect(sendSellerOrderPlaced).toHaveBeenCalledWith(
      expect.objectContaining({ to: "account@example.com" }),
    );
  });

  /*
   * THE ORDERING THAT MATTERS
   *
   * The push happens before the address is resolved, on purpose. A seller who never
   * set a contact email and whose account address has gone stale still has a handset
   * in their pocket — and that is the notification they actually feel. Gating it on
   * an email existing would switch off the better channel whenever the worse one is
   * missing.
   */
  it("still pushes when there is no address to email at all", async () => {
    const shop = { ...SHOP, contactEmail: null } as Shop;
    userFindFirst.mockResolvedValue(undefined);

    await notifySellerOfOrder({ shop, orderId: "order-1" });

    expect(sendSellerOrderPlaced).not.toHaveBeenCalled();
    expect(pushSellerOrder).toHaveBeenCalledOnce();
  });
});

describe("when a channel fails", () => {
  /*
   * By the time this runs, the order exists and the money is wherever it is. A mail
   * provider having a bad afternoon must never fail the thing it reports on — the
   * caller has already committed, and a throw here would surface as a failed
   * checkout for an order that succeeded.
   */
  it("does not throw when the mail throws", async () => {
    sendSellerOrderPlaced.mockRejectedValue(new Error("Resend is down"));

    await expect(notifySellerOfOrder({ shop: SHOP, orderId: "order-1" })).resolves.toBeUndefined();
  });

  it("does not throw when the push throws", async () => {
    pushSellerOrder.mockRejectedValue(new Error("Expo is down"));

    await expect(notifySellerOfOrder({ shop: SHOP, orderId: "order-1" })).resolves.toBeUndefined();
  });

  it("does not throw when the database throws", async () => {
    ordersFindFirst.mockRejectedValue(new Error("connection reset"));

    await expect(notifySellerOfOrder({ shop: SHOP, orderId: "order-1" })).resolves.toBeUndefined();
  });

  it("reports a refused send rather than swallowing it silently", async () => {
    sendSellerOrderPlaced.mockResolvedValue({ sent: false, reason: "no api key" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notifySellerOfOrder({ shop: SHOP, orderId: "order-1" });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no api key"));
  });
});

describe("a reported manual payment", () => {
  it("asks the seller to confirm the money arrived", async () => {
    await notifySellerOfPaymentReport({ shop: SHOP, orderId: "order-1", supplied: "reference" });

    expect(sendSellerOrderNeedsAction).toHaveBeenCalledWith(
      expect.objectContaining({ supplied: "reference", to: "seller@example.com" }),
    );
  });

  it("rides the orderNeedsAction preference", async () => {
    await notifySellerOfPaymentReport({ shop: SHOP, orderId: "order-1", supplied: "proof" });

    expect(wantsNotification).toHaveBeenCalledWith(SHOP.notificationPrefs, "orderNeedsAction");
  });

  it("is silenced by that preference", async () => {
    wantsNotification.mockReturnValue(false);

    await notifySellerOfPaymentReport({ shop: SHOP, orderId: "order-1", supplied: "proof" });

    expect(sendSellerOrderNeedsAction).not.toHaveBeenCalled();
  });

  /*
   * Unlike an order, a payment report does not push. That is a gap rather than a
   * decision — pinned here so that closing it is a visible change and not a
   * surprise, and so nobody reads the silence as intentional.
   */
  it("does not push today", async () => {
    await notifySellerOfPaymentReport({ shop: SHOP, orderId: "order-1", supplied: "proof" });

    expect(pushSellerOrder).not.toHaveBeenCalled();
  });

  it("does not throw when the mail fails", async () => {
    sendSellerOrderNeedsAction.mockRejectedValue(new Error("down"));

    await expect(
      notifySellerOfPaymentReport({ shop: SHOP, orderId: "order-1", supplied: "proof" }),
    ).resolves.toBeUndefined();
  });
});
