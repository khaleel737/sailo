import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getDictionary } from "@sailo/i18n";
import { buildHandoff, type Handoff } from "@/lib/payments";
import type { PaymentConfig } from "@sailo/db/schema";
import type { OrderIntentResult } from "@sailo/commerce/orders";
import { Confirmation } from "./confirmation";

/**
 * The screen a buyer lands on once the order exists.
 *
 * It is tested from the handoff rather than from a hand-written prop, because
 * the bug it exists to stop was the two disagreeing. The Instagram rail
 * redirected to `ig.me`, which cannot be handed a message — so the buyer left
 * with the order in nobody's hands and the seller received a blank DM, while
 * the rail's own description promised "copy the details from the next screen"
 * in thirty-five languages. Nothing failed: no error, no exception, an order
 * row written and a chat that never mentioned it.
 */

const t = getDictionary("en");

const order = {
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

const totals = {
  subtotalCents: 4550,
  discountCents: 0,
  deliveryFeeCents: 0,
  taxCents: 0,
  totalCents: 4550,
  commissionCents: 0,
  taxDeferred: false,
};

function render(handoff: Handoff | null, methodName: string) {
  const result: Extract<OrderIntentResult, { ok: true }> = {
    ok: true,
    orderId: "22222222-2222-2222-2222-222222222222",
    handoff,
    methodName,
    totals,
    currency: "USD",
    invoiceUrl: null,
    invoiceNumber: "INV-0007",
    downloadUrl: null,
    downloadPending: false,
    referral: null,
  };
  return renderToStaticMarkup(
    createElement(Confirmation, {
      result,
      shopId: "11111111-1111-1111-1111-111111111111",
      shopName: "Clay & Co",
      contactEmail: null,
      methodName,
      t,
      onClose: () => {},
    }),
  );
}

const instagram = (username = "clayandco") =>
  buildHandoff("instagram", { username } as PaymentConfig, order);

describe("the confirmation after an Instagram order", () => {
  it("shows the message the buyer has to paste", () => {
    const html = render(instagram(), "Instagram DM");
    expect(html).toContain("Speckled mug");
    expect(html).toContain("Dana Reed");
    expect(html).toContain("12 Alder Street, Portland");
    expect(html).toContain("INV-0007");
    expect(html).toContain("$45.50");
  });

  it("offers the DM as a link, and says to paste rather than to pay", () => {
    const html = render(instagram(), "Instagram DM");
    expect(html).toContain("https://ig.me/m/clayandco");
    expect(html).toContain("Open Instagram DM");
    expect(html).not.toContain("Pay with Instagram DM");
    expect(html).not.toContain("Paid by Instagram DM");
  });

  it("keeps a copy button beside the message", () => {
    // The clipboard can be refused, but a buyer who cannot press Copy at all
    // is back to retyping their own address into a DM.
    const html = render(instagram(), "Instagram DM");
    expect(html).toContain(t.checkout.copy);
    expect(html).toContain(t.checkout.yourOrder);
  });
});

describe("the confirmation on the rails that carry the order themselves", () => {
  it("does not ask a wallet buyer to paste anything", () => {
    const wallet = buildHandoff(
      "venmo",
      { venmoHandle: "clayandco" } as PaymentConfig,
      order,
    );
    const html = render(wallet, "Venmo");
    expect(html).toContain("Pay with Venmo");
    // The message exists on a wallet handoff too — it must not be rendered as
    // an instruction, or the buyer is told to send a chat nobody is reading.
    expect(html).not.toContain("Dana Reed");
    expect(html).not.toContain(t.checkout.yourOrder);
  });

  it("says nothing about pasting when the rail redirected", () => {
    // WhatsApp never reaches this screen — it leaves the page — but a rail
    // that starts doing so must not inherit the Instagram treatment.
    const html = render({ kind: "redirect", url: "https://wa.me/1" }, "WhatsApp");
    expect(html).toContain("Paid by WhatsApp");
    expect(html).not.toContain(t.checkout.yourOrder);
  });
});
