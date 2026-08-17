/**
 * The questions asked of the rail table.
 *
 * Whether a string is a rail, which rails an order may use, whether one is configured, whether
 * it is usable, whether it is available in a currency. Every one of them is a read of
 * `./rail-defs` — no rail-specific branches, which is the property the table exists to make
 * possible.
 *
 * `@sailo/payments/offline` still resolves through `./index`, so no caller moved.
 *
 * It re-exports `./rail-vocabulary` and `./rail-defs` because callers — including this
 * folder's own tests — have always imported the names and the table from `./rails`. The split
 * is about where the code lives, not about making every importer move.
 */

import type { PaymentConfig } from "@sailo/db/schema";
import { PAYMENT_METHOD_TYPES, type PaymentMethodType } from "./rail-vocabulary";
import { PAYMENT_METHOD_DEFS } from "./rail-defs";

export * from "./rail-vocabulary";
export * from "./rail-defs";

export function isElectronic(type: string) {
  return isPaymentMethodType(type) && PAYMENT_METHOD_DEFS[type].kind === "electronic";
}

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
