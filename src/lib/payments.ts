import type { PaymentConfig } from "@/db/schema";
import { normalizePhone } from "./utils";

export const PAYMENT_METHOD_TYPES = [
  "card",
  "whatsapp",
  "telegram",
  "instagram",
  "email",
  "phone",
  "bank_transfer",
  "cod",
] as const;

export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

/**
 * `contact` rails hand the buyer off to a chat app and settle entirely off
 * platform. `manual` rails keep the buyer on the page and show instructions,
 * with the seller confirming payment later. `electronic` rails take the money
 * then and there and confirm themselves, so the seller never marks them paid.
 */
export type RailKind = "contact" | "manual" | "electronic";

/** Rails that settle themselves — no seller action, no "I've paid" button. */
export function isElectronic(type: string) {
  return isPaymentMethodType(type) && PAYMENT_METHOD_DEFS[type].kind === "electronic";
}

export type ConfigField = {
  key: keyof PaymentConfig;
  label: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  multiline?: boolean;
};

export type PaymentMethodDef = {
  type: PaymentMethodType;
  kind: RailKind;
  name: string;
  /** Button text on the public shop. */
  action: string;
  description: string;
  fields: ConfigField[];
};

export const PAYMENT_METHOD_DEFS: Record<PaymentMethodType, PaymentMethodDef> = {
  card: {
    type: "card",
    kind: "electronic",
    name: "Card",
    action: "Pay by card",
    description:
      "Buyers pay by card, Apple Pay or Google Pay on Stripe's checkout. The money lands in your own Stripe account — Sailo never holds it and takes no cut.",
    // Configured by connecting a Stripe account, not by typing anything, so
    // the admin form for this rail is the Connect button instead of fields.
    fields: [],
  },
  whatsapp: {
    type: "whatsapp",
    kind: "contact",
    name: "WhatsApp",
    action: "Order on WhatsApp",
    description:
      "Opens WhatsApp with the order details filled in. Works in every country.",
    fields: [
      {
        key: "phone",
        label: "WhatsApp number",
        placeholder: "234801234567",
        hint: "Country code first, no + or spaces",
        required: true,
      },
    ],
  },
  telegram: {
    type: "telegram",
    kind: "contact",
    name: "Telegram",
    action: "Order on Telegram",
    description: "Opens a Telegram chat with the order details filled in.",
    fields: [
      {
        key: "username",
        label: "Telegram username",
        placeholder: "yourshop",
        hint: "Without the @",
        required: true,
      },
    ],
  },
  instagram: {
    type: "instagram",
    kind: "contact",
    name: "Instagram DM",
    action: "Order via Instagram",
    description:
      "Opens a DM with your account. Instagram can't prefill the message, so buyers get the details on screen to copy.",
    fields: [
      {
        key: "username",
        label: "Instagram username",
        placeholder: "yourshop",
        hint: "Without the @",
        required: true,
      },
    ],
  },
  email: {
    type: "email",
    kind: "contact",
    name: "Email",
    action: "Order by email",
    description: "Opens the buyer's mail app with the order written out.",
    fields: [
      {
        key: "address",
        label: "Order email address",
        placeholder: "orders@yourshop.com",
        required: true,
      },
    ],
  },
  phone: {
    type: "phone",
    kind: "contact",
    name: "Phone call",
    action: "Call to order",
    description: "Shows your number and dials it on mobile.",
    fields: [
      {
        key: "phone",
        label: "Phone number",
        placeholder: "+234 801 234 567",
        required: true,
      },
    ],
  },
  bank_transfer: {
    type: "bank_transfer",
    kind: "manual",
    name: "Bank transfer",
    action: "Pay by bank transfer",
    description:
      "Buyer sees your account details and sends the money, then submits a reference for you to confirm.",
    fields: [
      { key: "bankName", label: "Bank name", placeholder: "First Bank" },
      {
        key: "accountName",
        label: "Account name",
        placeholder: "Clay & Co. Ltd",
        required: true,
      },
      {
        key: "accountNumber",
        label: "Account number",
        placeholder: "0123456789",
      },
      { key: "iban", label: "IBAN", placeholder: "GB29 NWBK 6016 1331 9268 19" },
      { key: "swift", label: "SWIFT / BIC", placeholder: "NWBKGB2L" },
      {
        key: "instructions",
        label: "Extra instructions",
        placeholder: "Use your order name as the transfer reference.",
        multiline: true,
      },
    ],
  },
  cod: {
    type: "cod",
    kind: "manual",
    name: "Cash on delivery",
    action: "Pay on delivery",
    description:
      "Buyer pays when the order arrives. Preferred by most shoppers in the Middle East, Africa and South Asia.",
    fields: [
      {
        key: "instructions",
        label: "Delivery notes",
        placeholder: "We deliver within Lagos in 2–3 days. Please have exact cash.",
        multiline: true,
      },
    ],
  },
};

export const PAYMENT_METHOD_LIST = PAYMENT_METHOD_TYPES.map(
  (t) => PAYMENT_METHOD_DEFS[t],
);

export function isPaymentMethodType(value: string): value is PaymentMethodType {
  return (PAYMENT_METHOD_TYPES as readonly string[]).includes(value);
}

/** A rail is only usable once its required fields are filled in. */
export function isConfigured(type: string, config: PaymentConfig) {
  if (!isPaymentMethodType(type)) return false;
  return PAYMENT_METHOD_DEFS[type].fields
    .filter((f) => f.required)
    .every((f) => Boolean(config[f.key]?.toString().trim()));
}

/**
 * Whether a rail can actually take an order right now.
 *
 * Card has no fields to fill, so `isConfigured` would always say yes; what
 * makes it usable is a connected Stripe account that Stripe itself has cleared
 * for charges. A seller mid-onboarding is connected but not payable, and
 * offering the button then sends buyers into an error.
 */
export function isRailUsable(
  type: string,
  config: PaymentConfig,
  shop: { stripeAccountId: string | null; stripeChargesEnabled: boolean },
) {
  if (!isPaymentMethodType(type)) return false;
  if (type === "card") {
    return Boolean(shop.stripeAccountId && shop.stripeChargesEnabled);
  }
  return isConfigured(type, config);
}

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
    .filter(([, value]) => Boolean(value?.trim()))
    .map(([label, value]) => ({ label, value: value!.trim() }));
}
