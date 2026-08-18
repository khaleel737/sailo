import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as TransportModule from "@sailo/mailer/transport";
import type { Shop } from "@sailo/db/schema";

/**
 * What the seller is actually told, rendered.
 *
 * These four are the most consequential messages Sailo sends, and until this
 * file existed none of them was ever *executed* by the test suite: the preview
 * suite beside this one skips unless `EMAIL_PREVIEW_DIR` is set, so a crash in a
 * builder — a helper used wrongly, an undefined interpolated into a template —
 * would have surfaced only in production, where the notifier catches it, logs
 * it, and the seller silently gets nothing. Losing this email loses the case.
 *
 * So the assertions are about the two things that are worth getting right and
 * easy to get wrong:
 *
 * - **The money.** An inquiry has taken nothing; a chargeback has taken the
 *   amount *and* a fee. Saying the wrong one is a support ticket at best and a
 *   seller reconciling against a number that does not exist at worst.
 * - **The ask.** One thing, the thing that decides this reason — and nothing at
 *   all where the rail makes evidence pointless.
 */

const sent: { to: string; subject: string; html: string }[] = [];

vi.mock("@sailo/mailer/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof TransportModule>();
  return {
    ...actual,
    send: vi.fn(async (opts: { to: string; subject: string; html: string }) => {
      sent.push(opts);
      return { sent: true as const, id: "test" };
    }),
  };
});

const {
  sendSellerDisputeClosed,
  sendSellerDisputeDeadline,
  sendSellerDisputeOpened,
  sendSellerFraudWarning,
} = await import("./disputes");

const shop = { name: "Forno Nove", handle: "forno-nove" } as Shop;

const base = {
  shop,
  to: "seller@example.com",
  amountCents: 4200,
  feeCents: 1500,
  deductedCents: 5700,
  currency: "USD",
  reason: "product_not_received",
  dueBy: new Date("2026-09-05T00:00:00Z"),
  inquiry: false,
  orderTitle: "Speckled Mug",
  missing: ["A proof of delivery from your carrier"],
  now: new Date("2026-09-01T00:00:00Z"),
};

const last = () => sent[sent.length - 1]!;

beforeEach(() => {
  sent.length = 0;
});

describe("when a chargeback opens", () => {
  it("states the full deduction, not the sale price", async () => {
    /*
     * A $42 chargeback costs $57. A seller told $42 reconciles their bank
     * against a number 36% short, and the difference is a fee the card network
     * keeps whoever wins.
     */
    const result = await sendSellerDisputeOpened(base);

    expect(result.sent).toBe(true);
    /* `formatMoney` drops the decimals on a whole amount: `$57`, not `$57.00`. */
    expect(last().html).toContain("$57");
    expect(last().html).toContain("$15");
    expect(last().subject).toContain("$42");
  });

  it("says plainly that nothing has moved on an enquiry", async () => {
    await sendSellerDisputeOpened({ ...base, inquiry: true, deductedCents: 0 });

    expect(last().html).toContain("Nothing has been taken");
    expect(last().subject).toContain("asking about");
    /* And never implies a debit that has not happened. */
    expect(last().html).not.toContain("has been taken out of your balance");
  });

  it("asks for the one document that decides the case", async () => {
    await sendSellerDisputeOpened(base);
    expect(last().html).toContain("A proof of delivery from your carrier");
    expect(last().html).toContain("4.5 MB");
  });

  it("asks for nothing when everything is already on file", async () => {
    await sendSellerDisputeOpened({ ...base, missing: [] });
    expect(last().html).toContain("nothing you need to send");
  });

  it("does not send a bank-debit seller on an evidence hunt", async () => {
    /*
     * A SEPA or ACH return came back through the payer's own bank. There is no
     * issuer to persuade and no evidence that changes it, so a checklist here is
     * work that cannot affect the outcome.
     */
    await sendSellerDisputeOpened({ ...base, reason: "insufficient_funds" });

    expect(last().html).toContain("no evidence to send");
    expect(last().html).not.toContain("A proof of delivery from your carrier");
  });

  it("counts the days left rather than printing a bare date", async () => {
    await sendSellerDisputeOpened(base);
    expect(last().html).toContain("You have 4 days");
  });

  it("never shows a seller a rate", async () => {
    /*
     * A ratio is not something a seller can act on, and one they are close to
     * reads as a threat from their own software. The deadline and the document
     * are actionable; the rate is /hq's business.
     */
    await sendSellerDisputeOpened(base);
    const html = last().html.toLowerCase();
    expect(html).not.toContain("dispute rate");
    expect(html).not.toContain("chargeback ratio");
  });
});

describe("the deadline reminder", () => {
  it("leads with how long is left and what is still missing", async () => {
    const result = await sendSellerDisputeDeadline({ ...base, dueBy: new Date("2026-09-03T00:00:00Z") });

    expect(result.sent).toBe(true);
    expect(last().subject).toContain("2 days");
    expect(last().html).toContain("A proof of delivery from your carrier");
  });

  it("says so when nothing is outstanding", async () => {
    await sendSellerDisputeDeadline({ ...base, missing: [] });
    expect(last().html).toContain("Nothing is needed from you");
  });
});

describe("when it closes", () => {
  it("tells a winner the money came back, and that the fee did not", async () => {
    const result = await sendSellerDisputeClosed({
      shop,
      to: "seller@example.com",
      amountCents: 4200,
      feeCents: 1500,
      currency: "USD",
      reason: "product_not_received",
      orderTitle: "Speckled Mug",
      status: "won",
    });

    expect(result.sent).toBe(true);
    expect(last().subject).toContain("You won");
    expect(last().html).toContain("gone back into your balance");
    /* The fee is never returned, and a seller who expects it back will ask. */
    expect(last().html).toContain("is not returned");
  });

  it("tells a loser it is final, without moralising about their rate", async () => {
    await sendSellerDisputeClosed({
      shop,
      to: "seller@example.com",
      amountCents: 4200,
      feeCents: 1500,
      currency: "USD",
      reason: "fraudulent",
      orderTitle: "Speckled Mug",
      status: "lost",
    });

    expect(last().subject).toContain("was lost");
    expect(last().html).toContain("no further appeal");
    /*
     * And says the thing that is actually true and useful: the networks count
     * disputes raised, not disputes lost.
     */
    expect(last().html).toContain("how many disputes are raised");
  });

  it("reports a closed enquiry as the good news it is", async () => {
    await sendSellerDisputeClosed({
      shop,
      to: "seller@example.com",
      amountCents: 4200,
      feeCents: 0,
      currency: "USD",
      reason: "fraudulent",
      orderTitle: "Speckled Mug",
      status: "warning_closed",
    });

    expect(last().html).toContain("without becoming a chargeback");
    expect(last().html).toContain("No money moved");
  });
});

describe("an early fraud warning", () => {
  it("leads with the one action that still avoids the chargeback", async () => {
    const result = await sendSellerFraudWarning({
      shop,
      to: "seller@example.com",
      amountCents: 4200,
      currency: "USD",
      fraudType: "made_with_stolen_card",
      orderTitle: "Speckled Mug",
      orderId: "order-1",
    });

    expect(result.sent).toBe(true);
    expect(last().subject).toContain("refunding now avoids the chargeback");
    expect(last().html).toContain("Refunding now normally stops the chargeback");
  });

  it("is honest that refunding does not erase the fraud report", async () => {
    /*
     * The correction that stops a seller being surprised later by something they
     * cannot undo: the TC40/SAFE report counts towards Visa's fraud ratio whether
     * or not the charge is refunded. Refunding keeps the goods, not the record.
     */
    await sendSellerFraudWarning({
      shop,
      to: "seller@example.com",
      amountCents: 4200,
      currency: "USD",
      fraudType: "made_with_stolen_card",
      orderTitle: "Speckled Mug",
      orderId: "order-1",
    });

    expect(last().html).toContain("does not remove the fraud report");
  });

  it("renders the fraud type as words rather than an API constant", async () => {
    await sendSellerFraudWarning({
      shop,
      to: "seller@example.com",
      amountCents: 4200,
      currency: "USD",
      fraudType: "made_with_stolen_card",
      orderTitle: null,
      orderId: null,
    });

    expect(last().html).toContain("made with stolen card");
    expect(last().html).not.toContain("made_with_stolen_card");
  });
});
