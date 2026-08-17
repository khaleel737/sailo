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
 * The other thing worth a test is `confirmationSentAt`. A seller looking at an order
 * needs to tell "we emailed them" from "we tried", so the column is written only on
 * a send that actually succeeded — and it is the kind of line a refactor moves out of
 * an `if` without anybody noticing.
 */

const ordersFindFirst = vi.fn();
const itemsFindMany = vi.fn();
const sendOrderConfirmation = vi.fn();
const downloadUrl = vi.fn();

/** Everything written back to `orders`, so the timestamp can be asserted on. */
let updates: Record<string, unknown>[];

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
          return Promise.resolve();
        },
      }),
    }),
  }),
}));
vi.mock("@sailo/email/transactional", () => ({ sendOrderConfirmation }));
vi.mock("@sailo/commerce/orders/server", () => ({ downloadUrl }));

const { confirmBuyerByEmail } = await import("./confirm-buyer");

const SHOP = { id: "shop-1", handle: "ada" } as Shop;
const NOTHING = { deliversFiles: false, unlockNow: false, downloadToken: null };

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
  ordersFindFirst.mockResolvedValue({ id: "order-1", totalCents: 1999 });
  itemsFindMany.mockResolvedValue([{ id: "item-1", position: 0 }]);
  sendOrderConfirmation.mockResolvedValue({ sent: true });
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
    await call({ delivery: { deliversFiles: true, unlockNow: true, downloadToken: "tok" } });

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
    await call({ delivery: { deliversFiles: true, unlockNow: false, downloadToken: "tok" } });

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
    await call({ delivery: { deliversFiles: true, unlockNow: true, downloadToken: null } });

    expect(downloadUrl).not.toHaveBeenCalled();
    expect(sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ downloadUrl: null }),
    );
  });
});

describe("confirmationSentAt", () => {
  it("is written when the email actually went", async () => {
    await call();

    expect(updates).toHaveLength(1);
    expect(updates[0]?.confirmationSentAt).toBeInstanceOf(Date);
  });

  /*
   * The distinction the column exists for. A seller chasing a buyer who says they
   * never got the receipt needs to know whether we sent one.
   */
  it("is not written when the provider refused the send", async () => {
    sendOrderConfirmation.mockResolvedValue({ sent: false, reason: "no api key" });

    await call();

    expect(updates).toHaveLength(0);
  });

  it("is not written when the send threw", async () => {
    sendOrderConfirmation.mockRejectedValue(new Error("Resend is down"));

    await call();

    expect(updates).toHaveLength(0);
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
