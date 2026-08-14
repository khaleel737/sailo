import { Text as RNText, View } from "react-native";
import type { StatusTone } from "./types";

/**
 * A small coloured badge saying what state something is in.
 *
 * `label` and `tone` are separate arguments because the mapping between them is
 * the caller's: an order status is translated by `@sailo/i18n` and coloured by
 * a table that lives with the order screens, and baking either into this
 * component would put a domain in a design system.
 *
 * The tone is never the only signal. A pill carries its own word, so a seller
 * who cannot tell the green from the amber still reads "Confirmed".
 */
export type StatusPillProps = {
  label: string;
  /** @default "neutral" */
  tone?: StatusTone;
  /** @default "md" */
  size?: "sm" | "md";
  testID?: string;
};

export function StatusPill({ label, testID }: StatusPillProps) {
  return (
    <View testID={testID}>
      <RNText>{label}</RNText>
    </View>
  );
}
