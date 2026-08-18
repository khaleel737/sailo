/**
 * One definition per rail, and the whole reason this design exists.
 *
 * A switch per question — does it need an email, does it settle itself, what is the buyer
 * shown — is how a new rail ends up half-supported: added to four screens and missed by the
 * fifth. A new rail is a new entry here and every screen picks it up.
 *
 * It is a table rather than code, which is why it is 240 lines and why it is on its own: the
 * helpers that read it are small, and they were unreadable buried underneath it.
 */

import { PLATFORM_FEE_RANGE_LABEL } from "@sailo/core/plans";
import {
  type ConfigField,
  PAYPAL_CURRENCIES,
  type PaymentCategory,
  type PaymentMethodType,
  type RailKind,
} from "./rail-vocabulary";

export type PaymentMethodDef = {
  type: PaymentMethodType;
  kind: RailKind;
  /** Which section of the payments screen it sits in. See `PaymentCategory`. */
  category: PaymentCategory;
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
  /**
   * True when the rail can only *open* the conversation — the buyer carries
   * the order across themselves.
   *
   * Instagram alone. `ig.me/m/<user>` opens the DM and drops any query string,
   * and Instagram documents no way to prefill one, so the rail that behaved
   * like WhatsApp here delivered the seller an empty chat: the buyer left the
   * page and the order message went nowhere. `buildHandoff` reads this to keep
   * the buyer on the confirmation with the message to copy, and the checkout
   * reads it so the note under the button stops promising a prefill.
   */
  copyToSend?: boolean;
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
    category: "online",
    name: "Card",
    action: "Pay by card",
    // The fee is interpolated, never written out. This string said "1%" while
    // `platformFeeBp` charged half that, so every seller reading this card was
    // shown double what they were billed — exactly the drift the note on
    // `PLATFORM_FEE_RANGE_LABEL` exists to prevent.
    //
    // The range rather than a rate: these defs are a module-level constant
    // with no shop in scope, so there is no plan to read a single number off.
    // Surfaces that do hold a shop should say `platformFeeLabel(shop)` instead
    // of rendering this sentence.
    description:
      `Buyers pay by card, Apple Pay or Google Pay on Stripe's checkout. The money lands in your own Stripe account — Sailo never holds it, and keeps ${PLATFORM_FEE_RANGE_LABEL} of the goods depending on your plan.`,
    // Configured by connecting a Stripe account, not by typing anything, so
    // the admin form for this rail is the Connect button instead of fields.
    fields: [],
  },
  whatsapp: {
    type: "whatsapp",
    requires: {},
    settlesItself: false,
    kind: "contact",
    category: "chat",
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
    category: "chat",
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
    category: "chat",
    copyToSend: true,
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
    category: "chat",
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
    category: "chat",
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
    category: "manual",
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
    category: "wallet",
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
    category: "wallet",
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
    category: "manual",
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
