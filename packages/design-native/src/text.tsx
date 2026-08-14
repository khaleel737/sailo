import { Text as RNText } from "react-native";
import type { Alignment, TextVariant, TextWeight, Tone } from "./types.ts";

/**
 * Every string the app draws.
 *
 * There is no `style` prop and no `fontSize`. A screen says what a piece of
 * text *is* — a title, a caption — and the theme decides how that looks, which
 * is what lets Dynamic Type, dark mode and a later type-scale change happen in
 * one package instead of forty screens.
 */
export type TextProps = {
  children: React.ReactNode;
  /** @default "body" */
  variant?: TextVariant;
  /** @default "default" */
  tone?: Tone;
  /** Overrides the weight the variant would have used. Use sparingly. */
  weight?: TextWeight;
  /** @default "start" */
  align?: Alignment;
  /** Truncate with an ellipsis after this many lines. */
  numberOfLines?: number;
  /** Long-pressable to copy — order references, tracking numbers. */
  selectable?: boolean;
  /**
   * Announce this as a heading to a screen reader.
   *
   * Separate from `variant` because the two are different questions: a
   * `caption` can be the heading of a section and a `title` can be decorative.
   */
  heading?: boolean;
  testID?: string;
};

export function Text({ children, numberOfLines, selectable, heading, testID }: TextProps) {
  return (
    <RNText
      numberOfLines={numberOfLines}
      selectable={selectable}
      accessibilityRole={heading ? "header" : undefined}
      testID={testID}
    >
      {children}
    </RNText>
  );
}
