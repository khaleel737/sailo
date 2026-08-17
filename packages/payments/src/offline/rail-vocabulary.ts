/**
 * The vocabulary: which rails exist, and the words used to talk about them.
 *
 * The union of rail types, the three kinds a rail can be, the four categories a screen groups
 * them by, and the shape a configuration field has. Its own module because these names are
 * imported by the phone, the storefront and the admin — and none of those needs the 240-line
 * definition table behind them to know that `"bank_transfer"` is a rail.
 */

import type { PaymentConfig } from "@sailo/db/schema";

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

/**
 * What family a rail belongs to, for the screens that list them.
 *
 * Not the same question as `kind`, which is about *settlement* — who confirms
 * the payment and when. Two rails can settle identically and still be nothing
 * alike to a seller reading a list: PayPal and cash on delivery are both
 * `manual`, and one is a payment app the buyer taps through while the other is
 * a doorstep and a handful of notes. Grouping the admin screen by `kind` put
 * those two under one heading, which is how a list of ten rails reads as an
 * undifferentiated pile.
 *
 *   online   settles itself on the spot — card and the wallets Stripe carries
 *   wallet   a payment app the buyer opens, then comes back to confirm
 *   manual   your own instructions: a bank account, or cash in person
 *   chat     the order moves to a conversation and is agreed there
 *
 * Ordered by how much of the work the rail does for the seller, which is the
 * order the sections read in.
 */
export const PAYMENT_CATEGORIES = ["online", "wallet", "manual", "chat"] as const;

export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

/** Rails that settle themselves — no seller action, no "I've paid" button. */

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
