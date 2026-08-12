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
  "venmo",
  "paypal",
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

/**
 * The currencies a PayPal.Me link can name and have PayPal accept.
 *
 * PayPal documents 25, and three of them are excluded here rather than
 * offered and broken:
 *
 *  - **HUF and TWD** because PayPal takes no decimals on either, while
 *    `currency.ts` stores both at two — which is ISO-correct and what every
 *    other part of Sailo needs. A link would name `50.00HUF` and be refused.
 *  - **RUB** because PayPal suspended Russian operations in 2022, so the code
 *    is in their table and the payment is not.
 *
 * Sailo trades in more currencies than this — the three-decimal Gulf ones
 * (JOD, KWD, BHD, OMR, TND) are on none of PayPal's lists at all — which is
 * the whole reason this gate exists.
 */
export const PAYPAL_CURRENCIES = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD",
  "ILS", "JPY", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "SEK", "SGD",
  "THB", "USD",
] as const;

export type PaymentMethodDef = {
  type: PaymentMethodType;
  kind: RailKind;
  /**
   * Where the rail can actually settle. Absent means anywhere, which is the
   * honest answer for the chat rails, bank transfer and cash: they carry no
   * amount of their own and name no account we have to be right about.
   *
   * Only the wallets constrain this, and they constrain it on *currency*
   * rather than on the seller's country. Country decides whether a seller can
   * hold the account at all — theirs to know — but currency decides whether
   * the number we put in the link is the number the buyer is asked for, and
   * that one is ours to get right. A US seller pricing in euros would send a
   * buyer to `venmo.com/…?amount=45.50` and Venmo would read dollars.
   */
  availability?: { currencies: readonly string[] };
  /**
   * What the rail needs and does, stated once here rather than re-derived from
   * `kind` at each call site. Every place that asked "is this kind manual?"
   * had to know what that implied, and they didn't all agree — card needed an
   * email for its receipt and nothing asked for one until Stripe refused the
   * payment.
   */
  requires: {
    /**
     * The buyer must leave an email — a receipt has nowhere else to go.
     *
     * There is no `contact` flag beside it any more. It used to mark the rails
     * that settle later, on the reasoning that a chat rail identifies the
     * buyer by itself; the order row is written before the handoff, so it
     * doesn't, and every order now needs an email or a phone. A flag that is
     * true of everything decides nothing, so `readBuyer` asks for one
     * regardless of rail and this states only what a rail needs *extra*.
     */
    email?: boolean;
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
    requires: {},
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
  /*
   * Venmo and PayPal are manual rails and not electronic ones, because Sailo
   * never learns that the money arrived.
   *
   * Both have real APIs and neither is reachable from here. Venmo has no
   * Stripe support at all — it is PayPal-owned and sold only through
   * Braintree, which would be a second processor beside Stripe with its own
   * onboarding, webhooks and disputes. Stripe *does* carry PayPal, and
   * excludes this exact shape twice over: the US is absent from its supported
   * business locations, and it is not offered to platforms whose connected
   * accounts take payment directly, which is what Sailo is. Reaching it would
   * mean destination charges, and that makes Sailo the merchant of record.
   *
   * So the buyer gets a deep link and comes back to say they paid, exactly as
   * they do for a bank transfer. Everything Stripe *can* settle itself —
   * card, Apple Pay, Google Pay, Link, Cash App Pay — rides the card rail.
   */
  venmo: {
    type: "venmo",
    requires: {},
    settlesItself: false,
    kind: "manual",
    availability: { currencies: ["USD"] },
    name: "Venmo",
    action: "Pay with Venmo",
    description:
      "Opens Venmo with the amount already filled in, then the buyer confirms here. US sellers only — Venmo is USD, and a personal profile may not take business payments.",
    fields: [
      {
        key: "venmoHandle",
        label: "Venmo business profile",
        placeholder: "your-shop",
        // Venmo reverses payments for goods taken on a personal profile, and
        // the seller loses the money *and* the item they already posted. We
        // cannot tell one kind of handle from the other, so saying it here is
        // the whole of what we can do about it.
        hint: "Without the @. Must be a business profile — Venmo reverses business payments taken on a personal one.",
        required: true,
      },
    ],
  },
  paypal: {
    type: "paypal",
    requires: {},
    settlesItself: false,
    kind: "manual",
    availability: { currencies: PAYPAL_CURRENCIES },
    name: "PayPal",
    action: "Pay with PayPal",
    description:
      "Opens your PayPal.Me link with the amount already filled in, then the buyer confirms here.",
    fields: [
      {
        key: "paypalMe",
        label: "PayPal.Me username",
        placeholder: "yourshop",
        hint: "The last part of paypal.me/yourshop — paste the whole link if it's easier.",
        required: true,
      },
    ],
  },
  cod: {
    type: "cod",
    requires: {},
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
  shop: {
    stripeAccountId: string | null;
    stripeChargesEnabled: boolean;
    currency: string;
  },
) {
  if (!isPaymentMethodType(type)) return false;
  if (!isRailAvailable(type, shop.currency)) return false;
  if (type === "card") {
    return Boolean(shop.stripeAccountId && shop.stripeChargesEnabled);
  }
  return isConfigured(type, config);
}

/**
 * Whether this rail can settle the shop's currency at all.
 *
 * Separate from `isConfigured` because the two answer different questions and
 * the seller needs both told apart: "you haven't filled this in" is work they
 * can do, and "this cannot work in your currency" is not. The admin shows the
 * second as a stated reason rather than an empty form.
 *
 * Checked again in `isRailUsable`, which is what the storefront and the order
 * action both call — a seller who set Venmo up in dollars and then switched
 * the shop to euros must stop offering it, and nothing re-validates a rail
 * when the currency changes.
 */
export function isRailAvailable(type: string, currency: string) {
  if (!isPaymentMethodType(type)) return false;
  const allowed = PAYMENT_METHOD_DEFS[type].availability?.currencies;
  return !allowed || allowed.includes(currency.toUpperCase());
}
