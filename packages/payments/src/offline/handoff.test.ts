import { describe, expect, it } from "vitest";
import type { PaymentConfig } from "@sailo/db/schema";
import { buildHandoff, payAmount, type Handoff, type OrderSummary } from "./handoff";

/**
 * The wallet rails are a URL and nothing else — there is no API call to fail
 * loudly, so a wrong link is a silent one. Venmo answers an unknown handle
 * with an ordinary profile page and PayPal.Me with "user not found", and in
 * both cases the buyer believes they are paying somebody.
 */

const cfg = (o: Record<string, string> = {}) => o as PaymentConfig;

const order: OrderSummary = {
  shopName: "Clay & Co",
  productTitle: "Speckled mug",
  quantity: 1,
  priceLabel: "$45.50",
  totalCents: 4550,
  currency: "USD",
  customerName: "Dana Reed",
  address: "12 Alder Street, Portland",
  invoiceNumber: "INV-0007",
};

/**
 * The pay link, or a failed test. Narrows rather than asserting, so a rail
 * that quietly stopped producing one fails here by name instead of throwing
 * "cannot read properties of undefined" somewhere further down.
 */
function payUrlOf(handoff: Handoff | null): string {
  if (handoff?.kind !== "instructions" || !handoff.payUrl) {
    throw new Error(`expected a pay link, got ${JSON.stringify(handoff)}`);
  }
  return handoff.payUrl;
}

const q = (url: string) => new URL(url).searchParams;

describe("payAmount", () => {
  it("writes the major-unit amount at the currency's own precision", () => {
    expect(payAmount(4550, "USD")).toBe("45.50");
    expect(payAmount(4500, "USD")).toBe("45.00");
  });

  it("does not invent decimals on a zero-decimal currency", () => {
    // 1200 JPY is 1200 yen, not ¥12.00. `toFixed(2)` here would divide the
    // total by a hundred and ask the buyer for less than one percent of it.
    expect(payAmount(1200, "JPY")).toBe("1200");
  });

  it("keeps the third decimal on a three-decimal currency", () => {
    expect(payAmount(9999, "JOD")).toBe("9.999");
  });
});

describe("the Venmo rail", () => {
  it("builds a pay link carrying the order total", () => {
    const h = buildHandoff("venmo", cfg({ venmoHandle: "clayandco" }), order);
    expect(h?.kind).toBe("instructions");
    const url = payUrlOf(h);
    expect(url.startsWith("https://venmo.com/clayandco")).toBe(true);
    expect(q(url).get("txn")).toBe("pay");
    expect(q(url).get("amount")).toBe("45.50");
  });

  it("keeps the buyer's details out of the note", () => {
    // A Venmo note is public on the sender's feed by default. The message the
    // seller reads in a chat app carries a name and a delivery address, and
    // putting that string in the note would publish both.
    const h = buildHandoff("venmo", cfg({ venmoHandle: "clayandco" }), order);
    const note = q(payUrlOf(h)).get("note") ?? "";
    expect(note).toContain("INV-0007");
    expect(note).not.toContain("Dana Reed");
    expect(note).not.toContain("Alder Street");
    expect(note).not.toContain("Speckled mug");
  });

  it("accepts a handle however the seller pasted it", () => {
    const forms = ["clayandco", "@clayandco", "https://venmo.com/clayandco", " clayandco "];
    for (const venmoHandle of forms) {
      const h = buildHandoff("venmo", cfg({ venmoHandle }), order);
      expect(new URL(payUrlOf(h)).pathname).toBe("/clayandco");
    }
  });

  it("refuses to build a link with no handle", () => {
    // Otherwise the buyer is sent to venmo.com/?txn=pay, which is a real page
    // that pays nobody.
    expect(buildHandoff("venmo", cfg(), order)).toBeNull();
    expect(buildHandoff("venmo", cfg({ venmoHandle: "  " }), order)).toBeNull();
  });

  it("still returns the seller's message to copy", () => {
    const h = buildHandoff("venmo", cfg({ venmoHandle: "clayandco" }), order);
    expect(h?.kind === "instructions" && h.message).toContain("Speckled mug");
  });
});

describe("the PayPal rail", () => {
  it("puts the amount and its currency in the path", () => {
    const h = buildHandoff("paypal", cfg({ paypalMe: "clayandco" }), order);
    expect(h?.kind === "instructions" && h.payUrl).toBe(
      "https://paypal.me/clayandco/45.50USD",
    );
  });

  it("accepts a pasted paypal.me link", () => {
    const h = buildHandoff(
      "paypal",
      cfg({ paypalMe: "https://paypal.me/clayandco" }),
      order,
    );
    expect(h?.kind === "instructions" && h.payUrl).toBe(
      "https://paypal.me/clayandco/45.50USD",
    );
  });

  it("falls back to the bare profile when the total is unknown", () => {
    // A profile link still pays the seller; refusing outright would strand a
    // buyer over a missing amount they could type themselves.
    const { totalCents: _t, currency: _c, ...noTotal } = order;
    const h = buildHandoff("paypal", cfg({ paypalMe: "clayandco" }), noTotal);
    expect(h?.kind === "instructions" && h.payUrl).toBe("https://paypal.me/clayandco");
  });

  it("refuses to build a link with no handle", () => {
    expect(buildHandoff("paypal", cfg(), order)).toBeNull();
  });
});

describe("the rails that were already here", () => {
  it("leaves bank transfer and cash on delivery without a pay link", () => {
    // Both are instructions the seller wrote. Inventing a button for them
    // would send the buyer somewhere the seller never named.
    for (const type of ["bank_transfer", "cod"]) {
      const h = buildHandoff(type, cfg(), order);
      expect(h?.kind).toBe("instructions");
      expect(h?.kind === "instructions" && h.payUrl).toBeUndefined();
    }
  });

  it("still redirects the chat rails", () => {
    const h = buildHandoff("whatsapp", cfg({ phone: "1234567890" }), order);
    expect(h?.kind).toBe("redirect");
  });

  it("leaves card to the Stripe session", () => {
    expect(buildHandoff("card", cfg(), order)).toBeNull();
  });
});
