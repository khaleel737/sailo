import { Text as RNText, View } from "react-native";
import type { IconName } from "./types";

/**
 * Nothing here, and what to do about it.
 *
 * Empty is a state, not an absence — a screen that renders nothing when a query
 * comes back with no rows looks broken. The `action` slot is what separates
 * this from a shrug: "No products yet" with an "Add your first product" button
 * is an empty state, without one it is a dead end.
 */
export type EmptyStateProps = {
  title: string;
  /** One line on why it is empty, or what would fill it. */
  message?: string;
  icon?: IconName;
  /** The way out. Omit it only when there genuinely isn't one. */
  action?: { label: string; onPress: () => void };
  testID?: string;
};

export function EmptyState({ title, message, testID }: EmptyStateProps) {
  return (
    <View testID={testID}>
      <RNText accessibilityRole="header">{title}</RNText>
      {message ? <RNText>{message}</RNText> : null}
    </View>
  );
}
