import { Text as RNText } from "react-native";
import { formatMoney } from "@sailo/core/currency";
import type { TextVariant, TextWeight, Tone } from "./types";

/**
 * An amount of money, in minor units, drawn the way the rest of Sailo draws it.
 *
 * A component rather than a helper because every amount in the product should
 * arrive at the screen the same way: `formatMoney` from `@sailo/core/currency`
 * knows that a yen is its own minor unit and a dinar has three, so nothing here
 * divides by a hundred. That is the bug this exists to make unrepeatable — a
 * flat `/100` showed a seller pricing in JPY a hundredth of what they charged.
 *
 * `minor` and `currency` are two separate props, and both are required, because
 * they are two separate columns. Every order and price in the schema stores an
 * integer and a code beside it; a component that took a formatted string would
 * let a screen do the arithmetic, which is where it goes wrong.
 */
export type MoneyProps = {
  /** Integer minor units, exactly as the row stores it — `totalCents` and friends. */
  minor: number;
  /** ISO 4217, from the same row. Never assumed. */
  currency: string;
  /**
   * The reader's locale, for separators and symbol position. Defaults to the
   * shared formatter's `en-US` — pass the app's active locale for a seller
   * reading in anything else.
   */
  locale?: string;
  /**
   * Draw a refund or a discount as a negative — "− $12.00" — from a positive
   * stored amount. `refundedCents` and `discountCents` are stored unsigned, so
   * without this a screen would have to negate them itself and get the minus
   * sign wrong in Arabic.
   */
  negative?: boolean;
  /** @default "body" */
  variant?: TextVariant;
  /** @default "default" */
  tone?: Tone;
  weight?: TextWeight;
  testID?: string;
};

export function Money({ minor, currency, locale, negative, testID }: MoneyProps) {
  const amount = formatMoney(minor, currency, locale);
  return <RNText testID={testID}>{negative ? `− ${amount}` : amount}</RNText>;
}
