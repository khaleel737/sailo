import type { PaymentConfig } from "@sailo/db/schema";
import { PLATFORM_FEE_LABEL } from "@/lib/plans";

/**
 * The rails a shop can take money through, and what each one needs.
 *
 * One definition per rail rather than a switch per question: whether it needs
 * an email, whether it settles itself, what the buyer is shown. A new rail is
 * a new entry here, and every screen picks it up.
 */

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
  /**
   * What the rail needs and does, stated once here rather than re-derived from
   * `kind` at each call site. Every place that asked "is this kind manual?"
   * had to know what that implied, and they didn't all agree — card needed an
   * email for its receipt and nothing asked for one until Stripe refused the
   * payment.
   */
  requires: {
    /** The buyer must leave an email — a receipt has nowhere else to go. */
    email?: boolean;
    /** An email or a phone will do; the seller just has to reach them. */
    contact?: boolean;
  };
  /** True when payment confirms itself and the seller never marks it paid. */
  settlesItself: boolean;
  /**
   * True when the rail collects payment in person, at a moment the seller
   * controls — a doorstep, a venue door, an appointment.
   *
   * Cash on delivery is the only one. It belongs on any order with such a
   * moment (a physical good, an event ticket, a booked service, or a file held
   * until paid) and nowhere else: an instant download unlocks on order, so
   * "pay when we meet" is an offer it cannot keep.
   */
  payInPerson?: boolean;
  name: string;
  /** Button text on the public shop. */
  action: string;
  description: string;
  fields: ConfigField[];
};

export const PAYMENT_METHOD_DEFS: Record<PaymentMethodType, PaymentMethodDef> = {
  card: {
    type: "card",
    requires: { email: true },
    settlesItself: true,
    kind: "electronic",
    name: "Card",
    action: "Pay by card",
    // The fee is interpolated, never written out. This string said "1%" while
    // `platformFeeBp` charged half that, so every seller reading this card was
    // shown double what they were billed — exactly the drift the note on
    // `PLATFORM_FEE_LABEL` exists to prevent.
    description:
      `Buyers pay by card, Apple Pay or Google Pay on Stripe's checkout. The money lands in your own Stripe account — Sailo never holds it, and keeps ${PLATFORM_FEE_LABEL} of the goods.`,
    // Configured by connecting a Stripe account, not by typing anything, so
    // the admin form for this rail is the Connect button instead of fields.
    fields: [],
  },
  whatsapp: {
    type: "whatsapp",
    requires: {},
    settlesItself: false,
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
    requires: {},
    settlesItself: false,
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
    requires: {},
    settlesItself: false,
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
    requires: {},
    settlesItself: false,
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
    requires: {},
    settlesItself: false,
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
    requires: { contact: true },
    settlesItself: false,
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
    requires: { contact: true },
    settlesItself: false,
    payInPerson: true,
    kind: "manual",
    name: "Cash on delivery",
    action: "Pay on delivery",
    description:
      "Buyer pays in person — on delivery, at the door, or at the appointment. Preferred by most shoppers in the Middle East, Africa and South Asia.",
    fields: [
      {
        key: "instructions",
        label: "Delivery notes",
        placeholder: "We deliver within Portland in 2–3 days. Please have exact cash.",
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

/**
 * The rails that can take *this* order.
 *
 * `canPayInPerson` asks whether the basket has a moment where the seller
 * collects payment in person — a doorstep, a venue door, an appointment. A
 * pay-in-person rail (cash on delivery) belongs only when it does. A shop
 * selling both a mug and an instant download enables cash on delivery once,
 * for the mug; nothing then took it off the download's checkout, so a buyer of
 * a file that unlocks on order was offered a rail whose whole promise is
 * collecting cash later — after the file was already gone. Everything with a
 * controlled collection moment (physical, event, appointment, or a file held
 * until paid) keeps the rail.
 *
 * Typed on the shape rather than on `CheckoutMethod`, so the storefront's
 * trimmed object and a database row both pass through the one filter — and so
 * the server can re-decide, which it does, because this list is a suggestion
 * the browser is free to ignore.
 */
export function railsForOrder<T extends { type: string }>(
  methods: readonly T[],
  canPayInPerson: boolean,
): T[] {
  if (canPayInPerson) return [...methods];
  return methods.filter(
    (m) =>
      !isPaymentMethodType(m.type) || !PAYMENT_METHOD_DEFS[m.type].payInPerson,
  );
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
