import { formatMoney } from "@sailo/core/currency";
import type { TextVariant, TextWeight, Tone } from "./types";
import { Text } from "./text";

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

export function Money({
  minor,
  currency,
  locale,
  negative = false,
  variant = "body",
  tone = "default",
  weight,
  testID,
}: MoneyProps) {
  const amount = formatMoney(minor, currency, locale);

  return (
    <Text
      variant={variant}
      tone={tone}
      weight={weight}
      /*
       * An amount is a number a seller reads across a column, and a proportional
       * font moves the digits around as the value changes. `numberOfLines` keeps
       * it on one line: a wrapped total in a list row is a total that has
       * silently become two rows tall.
       */
      numberOfLines={1}
      /* Long-pressable, so a figure can be copied into a message to a buyer. */
      selectable
      testID={testID}
    >
      {/*
       * U+2212 MINUS SIGN, not a hyphen-minus: at the sizes this is read at a
       * hyphen is short enough to look like a stray dash. `formatMoney` has
       * already put the currency symbol on whichever side the locale wants, so
       * the sign goes outside all of it rather than being spliced in.
       */}
      {negative ? `− ${amount}` : amount}
    </Text>
  );
}
