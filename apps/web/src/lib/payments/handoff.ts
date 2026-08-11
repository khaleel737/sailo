import { normalizePhone } from "@/lib/utils";
import type { PaymentConfig } from "@sailo/db/schema";
import { isPaymentMethodType } from "./rails";

/** What happens to the buyer once they have chosen how to pay. */

export type OrderSummary = {
  shopName: string;
  productTitle: string;
  quantity: number;
  /** The final total, after any discount and delivery fee. */
  priceLabel: string;
  productUrl?: string;
  customerName?: string;
  note?: string;
  address?: string;
  delivery?: string;
  discount?: string;
  invoiceNumber?: string;
};

export function orderMessage(order: OrderSummary) {
  const lines = [
    `Hi ${order.shopName}! I'd like to order:`,
    ``,
    `${order.productTitle}`,
    `Quantity: ${order.quantity}`,
  ];
  if (order.discount) lines.push(`Discount: ${order.discount}`);
  if (order.delivery) lines.push(`Delivery: ${order.delivery}`);
  lines.push(`Total: ${order.priceLabel}`);
  if (order.customerName) lines.push(`Name: ${order.customerName}`);
  if (order.address) lines.push(`Deliver to: ${order.address}`);
  if (order.note) lines.push(`Note: ${order.note}`);
  if (order.invoiceNumber) lines.push(`Invoice: ${order.invoiceNumber}`);
  if (order.productUrl) lines.push(``, order.productUrl);
  return lines.join("\n");
}

export type Handoff =
  | { kind: "redirect"; url: string }
  /** Buyer stays on the page; `message` is offered for copy/paste. */
  | { kind: "instructions"; message?: string };

/**
 * Turns a configured rail plus an order into the buyer's next step. Returns
 * null when the rail can't be actioned, so callers fall back to a plain
 * confirmation.
 */
export function buildHandoff(
  type: string,
  config: PaymentConfig,
  order: OrderSummary,
): Handoff | null {
  if (!isPaymentMethodType(type)) return null;
  const message = orderMessage(order);

  switch (type) {
    case "whatsapp": {
      const phone = normalizePhone(config.phone ?? "");
      if (!phone) return null;
      return {
        kind: "redirect",
        url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
      };
    }
    case "telegram": {
      const username = (config.username ?? "").replace(/^@/, "").trim();
      if (!username) return null;
      return {
        kind: "redirect",
        url: `https://t.me/${username}?text=${encodeURIComponent(message)}`,
      };
    }
    case "instagram": {
      const username = (config.username ?? "").replace(/^@/, "").trim();
      if (!username) return null;
      // Instagram can't prefill a DM, so the buyer copies the message across.
      return { kind: "redirect", url: `https://ig.me/m/${username}` };
    }
    case "email": {
      const address = (config.address ?? "").trim();
      if (!address) return null;
      const subject = `Order: ${order.productTitle}`;
      return {
        kind: "redirect",
        url: `mailto:${address}?subject=${encodeURIComponent(
          subject,
        )}&body=${encodeURIComponent(message)}`,
      };
    }
    case "phone": {
      const phone = (config.phone ?? "").trim();
      if (!phone) return null;
      return { kind: "redirect", url: `tel:${phone.replace(/[^\d+]/g, "")}` };
    }
    case "bank_transfer":
    case "cod":
      return { kind: "instructions", message };

    // Card can't be resolved here: the buyer's next step is a Stripe Checkout
    // Session, which needs the saved order to exist first. `createOrderIntent`
    // builds that redirect once it has an order id.
    case "card":
      return null;
  }
}

/** Human-readable account lines shown to the buyer after a bank transfer order. */
export function bankDetailLines(config: PaymentConfig) {
  return (
    [
      ["Bank", config.bankName],
      ["Account name", config.accountName],
      ["Account number", config.accountNumber],
      ["IBAN", config.iban],
      ["SWIFT / BIC", config.swift],
    ] as const
  )
    // One pass rather than filter-then-assert: the filter proved the value was
    // there and the map had to swear to it again, which is exactly the kind of
    // promise that stops being true when someone edits one line and not the other.
    .flatMap(([label, value]) => {
      const trimmed = value?.trim();
      return trimmed ? [{ label, value: trimmed }] : [];
    });
}
