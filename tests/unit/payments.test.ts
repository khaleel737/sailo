import { describe, expect, it } from "vitest";
import {
  bankDetailLines,
  buildHandoff,
  isConfigured,
  isPaymentMethodType,
  isRailUsable,
  orderMessage,
  PAYMENT_METHOD_DEFS,
  PAYMENT_METHOD_LIST,
  PAYMENT_METHOD_TYPES,
} from "@/lib/payments";

const summary = {
  shopName: "Clay & Co",
  productTitle: "Speckled mug",
  quantity: 2,
  priceLabel: "$48.00",
};

const connected = { stripeAccountId: "acct_1", stripeChargesEnabled: true };
const notConnected = { stripeAccountId: null, stripeChargesEnabled: false };

describe("the rail catalogue", () => {
  it("recognises only the types it ships", () => {
    for (const t of PAYMENT_METHOD_TYPES) expect(isPaymentMethodType(t)).toBe(true);
    expect(isPaymentMethodType("bitcoin")).toBe(false);
  });

  it("gives every rail a definition", () => {
    expect(PAYMENT_METHOD_LIST).toHaveLength(PAYMENT_METHOD_TYPES.length);
    for (const def of PAYMENT_METHOD_LIST) {
      expect(def.name).toBeTruthy();
      expect(def.action).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });

  it("declares what each rail needs rather than leaving it to be inferred", () => {
    for (const def of PAYMENT_METHOD_LIST) {
      expect(typeof def.requires).toBe("object");
      expect(typeof def.settlesItself).toBe("boolean");
    }
  });

  it("only lets electronic rails settle themselves", () => {
    // A rail that settles itself needs no "mark as paid" from the seller.
    // Any other kind claiming that would strand orders as unconfirmed.
    for (const def of PAYMENT_METHOD_LIST) {
      expect(def.settlesItself).toBe(def.kind === "electronic");
    }
  });

  it("asks card for an email and manual rails for any contact", () => {
    expect(PAYMENT_METHOD_DEFS.card.requires.email).toBe(true);
    expect(PAYMENT_METHOD_DEFS.bank_transfer.requires.contact).toBe(true);
    expect(PAYMENT_METHOD_DEFS.whatsapp.requires.email).toBeFalsy();
  });
});

describe("isConfigured", () => {
  it("wants a phone for WhatsApp", () => {
    expect(isConfigured("whatsapp", {})).toBe(false);
    expect(isConfigured("whatsapp", { phone: "234801234567" })).toBe(true);
  });

  it("ignores blank whitespace", () => {
    expect(isConfigured("whatsapp", { phone: "   " })).toBe(false);
  });

  it("rejects a type it doesn't know", () => {
    expect(isConfigured("carrier-pigeon", {})).toBe(false);
  });
});

describe("isRailUsable", () => {
  it("needs a connected account for card", () => {
    expect(isRailUsable("card", {}, notConnected)).toBe(false);
  });

  it("refuses card while Stripe is still verifying", () => {
    // Connected is not the same as payable. Offering the button here sends
    // buyers into an error at the last step.
    expect(
      isRailUsable("card", {}, { stripeAccountId: "acct_1", stripeChargesEnabled: false }),
    ).toBe(false);
  });

  it("allows card once charges are enabled", () => {
    expect(isRailUsable("card", {}, connected)).toBe(true);
  });

  it("leaves other rails independent of Stripe", () => {
    expect(isRailUsable("whatsapp", { phone: "234801" }, notConnected)).toBe(true);
  });
});

describe("buildHandoff", () => {
  it("sends WhatsApp to wa.me with the order written out", () => {
    const h = buildHandoff("whatsapp", { phone: "234801234567" }, summary);
    expect(h?.kind).toBe("redirect");
    if (h?.kind === "redirect") {
      expect(h.url).toContain("wa.me/234801234567");
      expect(decodeURIComponent(h.url)).toContain("Speckled mug");
    }
  });

  it("keeps a bank transfer on the page", () => {
    const h = buildHandoff("bank_transfer", { accountName: "Clay Ltd" }, summary);
    expect(h?.kind).toBe("instructions");
  });

  it("returns nothing for card — the session doesn't exist yet", () => {
    // Card's next step is a Stripe session, which needs a saved order id.
    expect(buildHandoff("card", {}, summary)).toBeNull();
  });

  it("returns nothing for an unconfigured rail", () => {
    expect(buildHandoff("whatsapp", {}, summary)).toBeNull();
    expect(buildHandoff("telegram", {}, summary)).toBeNull();
  });

  it("returns nothing for a type it doesn't know", () => {
    expect(buildHandoff("pigeon", {}, summary)).toBeNull();
  });

  it("strips an @ from a Telegram handle", () => {
    const h = buildHandoff("telegram", { username: "@clayco" }, summary);
    expect(h?.kind === "redirect" && h.url).toContain("t.me/clayco");
  });
});

describe("orderMessage", () => {
  it("names the shop, the product and the total", () => {
    const msg = orderMessage(summary);
    expect(msg).toContain("Clay & Co");
    expect(msg).toContain("Speckled mug");
    expect(msg).toContain("$48.00");
  });

  it("includes the invoice number when there is one", () => {
    expect(orderMessage({ ...summary, invoiceNumber: "INV-0042" })).toContain("INV-0042");
  });
});

describe("bankDetailLines", () => {
  it("lists only the fields that were filled in", () => {
    const lines = bankDetailLines({ accountName: "Clay Ltd", iban: "GB29 NWBK" });
    const labels = lines.map((l) => l.label);
    expect(labels).toContain("Account name");
    expect(labels).toContain("IBAN");
    expect(labels).not.toContain("SWIFT / BIC");
  });

  it("is empty when nothing is configured", () => {
    expect(bankDetailLines({})).toHaveLength(0);
  });
});
