import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Shop } from "@sailo/db/schema";

/**
 * Telling the buyer their order landed.
 *
 * The subtlety this file pins is what the email is *allowed to claim*. On the card
 * rail this runs once the Checkout Session exists but before the buyer has paid —
 * they may still abandon it — so what goes out has to read as "we have your order",
 * never "we have your money". An earlier version of the source comment asserted the
 * payment was settled, and it was wrong on every rail.
 *
 * The other thing worth a test is `confirmationSentAt`, which is two properties at
 * once. A seller looking at an order needs to tell "we emailed them" from "we
 * tried", so a send that did not happen must leave the column null. And exactly
 * one receipt may go out per order however many settling events Stripe delivers,
 * so the column is *claimed* in a conditional UPDATE before the send rather than
 * stamped after it — a read in the caller is not a claim, and both callers only
 * had a read.
 */

const ordersFindFirst = vi.fn();
const itemsFindMany = vi.fn();
const sendOrderConfirmation = vi.fn();
const downloadUrl = vi.fn();
const logOrderMessage = vi.fn();

/** Everything written back to `orders`, so the timestamp can be asserted on. */
let updates: Record<string, unknown>[];

/**
 * Whether the conditional claim finds the column still null.
 *
 * `false` is the second settling event for one order: the UPDATE matches no row
 * and returns nothing, and nothing should be sent.
 */
let claimWon: boolean;

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: {
      orders: { findFirst: ordersFindFirst },
      orderItems: { findMany: itemsFindMany },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          const rows = claimWon || values.confirmationSentAt === null
            ? [{ id: "order-1" }]
            : [];
          return Object.assign(Promise.resolve(rows), {
            returning: () => Promise.resolve(rows),
          });
        },
      }),
    }),
  }),
}));
vi.mock("@sailo/email/transactional", () => ({ sendOrderConfirmation }));
vi.mock("@sailo/commerce/orders/server", () => ({ downloadUrl }));
vi.mock("@sailo/commerce/disputes", () => ({ logOrderMessage }));

const { confirmBuyerByEmail } = await import("./confirm-buyer");

const SHOP = { id: "shop-1", handle: "ada" } as Shop;
/*
 * Nothing to deliver at all. `deliversAccess` is the spec 48 half — a link or a
 * code is as much the good as a file is — and it is false here for the same
 * reason `deliversFiles` is.
 */
const NOTHING = {
  deliversFiles: false,
  deliversAccess: false,
  unlockNow: false,
  downloadToken: null,
};

const call = (overrides: Partial<Parameters<typeof confirmBuyerByEmail>[0]> = {}) =>
  confirmBuyerByEmail({
    shop: SHOP,
    orderId: "order-1",
    invoice: null,
    delivery: NOTHING,
    base: "https://sailo.store",
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  updates = [];
  claimWon = true;
  ordersFindFirst.mockResolvedValue({ id: "order-1", totalCents: 1999 });
  itemsFindMany.mockResolvedValue([{ id: "item-1", position: 0 }]);
  sendOrderConfirmation.mockResolvedValue({
    sent: true,
    id: "resend-1",
    subject: "Your order from Ada",
    text: "Thanks — Ada has your order.",
  });
  downloadUrl.mockReturnValue("https://sailo.store/download/tok");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("what the email is built from", () => {
  /*
   * Read back rather than reuse the values that built the insert: by this point the
   * card handoff has written the Stripe session onto the row, and composing from the
   * in-memory draft would describe an order that never quite existed.
   */
  it("uses the saved row, not the caller's draft", async () => {
    await call();

    expect(ordersFindFirst).toHaveBeenCalledOnce();
    expect(sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ order: { id: "order-1", totalCents: 1999 } }),
    );
  });

  it("sends nothing at all when the order is not there", async () => {
    ordersFindFirst.mockResolvedValue(undefined);

    await call();

    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("orders the line items, so the email matches the invoice", async () => {
    await call();

    expect(itemsFindMany).toHaveBeenCalledOnce();
  });
});

describe("the invoice link", () => {
  it("is included when there is an invoice to link to", async () => {
    await call({ invoice: { token: "inv-tok", number: "2026-0001" } });

    expect(sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceUrl: "https://sailo.store/invoice/inv-tok",
        invoiceNumber: "2026-0001",
      }),
    );
  });

  it("is null when there is no invoice, rather than a link to nowhere", async () => {
    await call({ invoice: null });

    expect(sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceUrl: null, invoiceNumber: null }),
    );
  });

  /*
   * `undefined` and `null` both reach here — one from a rail that has no invoice
   * concept, one from a rail that decided against it — and both must produce the
   * same email rather than `undefined` landing in a URL.
   */
  it("treats an absent invoice the same as no invoice", async () => {
    await call({ invoice: undefined });

    expect(sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceUrl: null }),
    );
  });
});

describe("digital delivery", () => {
  it("links the download when the files are unlocked now", async () => {
    await call({ delivery: { ...NOTHING, deliversFiles: true, unlockNow: true, downloadToken: "tok" } });

    expect(downloadUrl).toHaveBeenCalledWith("tok", "https://sailo.store");
    expect(sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ downloadUrl: "https://sailo.store/download/tok" }),
    );
  });

  /*
   * Files exist but the money has not cleared. The email says so rather than going
   * out with no mention of what they bought — a buyer who paid by transfer and got a
   * receipt listing nothing downloadable assumes the sale failed.
   */
  it("says a download is pending when the files are held", async () => {
    await call({ delivery: { ...NOTHING, deliversFiles: true, unlockNow: false, downloadToken: "tok" } });

    expect(sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ downloadUrl: null, downloadPending: true }),
    );
  });

  it("claims nothing pending for an order with no files", async () => {
    await call();

    expect(sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ downloadUrl: null, downloadPending: false }),
    );
  });

  /*
   * Unlocked but tokenless is a state that should not exist, and if it does the
   * email must not contain the string "undefined" where a link belongs.
   */
  it("links nothing when unlocked with no token", async () => {
    await call({ delivery: { ...NOTHING, deliversFiles: true, unlockNow: true, downloadToken: null } });

    expect(downloadUrl).not.toHaveBeenCalled();
    expect(sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ downloadUrl: null }),
    );
  });
});

describe("confirmationSentAt", () => {
  /** What the column reads as once everything this call did has settled. */
  const finalValue = () => updates.at(-1)?.confirmationSentAt;

  it("is written when the email actually went", async () => {
    await call();

    expect(updates).toHaveLength(1);
    expect(finalValue()).toBeInstanceOf(Date);
  });

  /*
   * The distinction the column exists for. A seller chasing a buyer who says they
   * never got the receipt needs to know whether we sent one — and a send that did
   * not happen has to stay retryable, which a held claim would not be.
   */
  it("is given back when the provider refused the send", async () => {
    sendOrderConfirmation.mockResolvedValue({ sent: false, reason: "no api key" });

    await call();

    expect(finalValue()).toBeNull();
  });

  it("is given back when the send threw", async () => {
    sendOrderConfirmation.mockRejectedValue(new Error("Resend is down"));

    await call();

    expect(finalValue()).toBeNull();
  });

  /*
   * THE CLAIM
   *
   * Stripe delivers settling events for one order under more than one type and
   * therefore more than one id, so the webhook route's event-id claim does not
   * fence them: `checkout.session.completed` and
   * `checkout.session.async_payment_succeeded` for the same session both find the
   * column null under a plain read, and both send. Two receipts with two invoice
   * links for one order is the shape of bug that makes a buyer ask whether they
   * were charged twice.
   */
  it("sends nothing when another caller already claimed it", async () => {
    claimWon = false;

    await call();

    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("does not release a claim it did not win", async () => {
    claimWon = false;

    await call();

    // One attempt to claim, and no write putting anybody else's claim back.
    expect(updates).toHaveLength(1);
    expect(updates[0]?.confirmationSentAt).toBeInstanceOf(Date);
  });

  it("claims before sending, not after", async () => {
    /*
     * The ordering is the whole property. Claiming afterwards is what a read in
     * the caller already was — two callers both get past it.
     */
    let claimedBySendTime = false;
    sendOrderConfirmation.mockImplementation(async () => {
      claimedBySendTime = updates.some((u) => u.confirmationSentAt instanceof Date);
      return { sent: true };
    });

    await call();

    expect(claimedBySendTime).toBe(true);
  });
});

describe("keeping the message, because a chargeback is answered with it", () => {
  /*
   * SPEC 44
   *
   * Stripe's `customer_communication` evidence slot asks for the messages sent
   * to the buyer, and `FILE_ASKS` was asking the *seller* to upload the ones
   * Sailo had itself sent and thrown away.
   */
  it("records what was sent, with the provider's id", async () => {
    await call();

    expect(logOrderMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        shopId: "shop-1",
        kind: "confirmation",
        subject: "Your order from Ada",
        bodyText: "Thanks — Ada has your order.",
        providerMessageId: "resend-1",
        status: "sent",
      }),
    );
  });

  it("records nothing when the provider refused the send", async () => {
    /*
     * The rule the whole evidence pipeline is written around: never state a fact
     * Sailo does not hold. A logged message that never went is worse than no log
     * — it is a false claim to a bank, made on the seller's behalf.
     */
    sendOrderConfirmation.mockResolvedValue({ sent: false, reason: "no api key" });

    await call();

    expect(logOrderMessage).not.toHaveBeenCalled();
  });

  it("records nothing when another caller had already claimed the send", async () => {
    claimWon = false;

    await call();

    expect(logOrderMessage).not.toHaveBeenCalled();
  });

  it("logs the message the buyer was actually sent to", async () => {
    ordersFindFirst.mockResolvedValue({
      id: "order-1",
      totalCents: 1999,
      customerEmail: "buyer@example.com",
    });

    await call();

    expect(logOrderMessage).toHaveBeenCalledWith(
      expect.objectContaining({ toAddress: "buyer@example.com" }),
    );
  });
});

describe("failing without failing the checkout", () => {
  /*
   * THE CONTRACT, AND IT USED TO BE MISSING
   *
   * Only the provider's own `{sent:false}` was handled; the two reads and the
   * timestamp write threw straight out into `createOrderIntent`, which has no catch
   * around this call. After the reorder put this step *after* the Stripe handoff, a
   * transient database error failed the whole action for an order whose payment had
   * already been set up — the buyer saw an error for an order that existed and was
   * payable, and could not tell which.
   */
  it("swallows a thrown read", async () => {
    ordersFindFirst.mockRejectedValue(new Error("connection reset"));

    await expect(call()).resolves.toBeUndefined();
  });

  it("swallows a thrown send", async () => {
    sendOrderConfirmation.mockRejectedValue(new Error("Resend is down"));

    await expect(call()).resolves.toBeUndefined();
  });

  it("logs a refusal rather than passing it back", async () => {
    sendOrderConfirmation.mockResolvedValue({ sent: false, reason: "suppressed" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await call();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("suppressed"));
  });
});
