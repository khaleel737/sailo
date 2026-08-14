import { Pressable, Text as RNText } from "react-native";
import type { IconName, Edge, Size } from "./types.ts";

/**
 * The thing a seller taps.
 *
 * `label` is a string rather than children, and that is the point: a button
 * whose content is arbitrary JSX is a button somebody eventually puts an
 * untranslated literal inside. One string, from `@sailo/i18n/native`, and the
 * component decides how it is drawn.
 */
export type ButtonProps = {
  label: string;
  onPress: () => void;
  /**
   * `primary` is the one thing this screen wants done — at most one per view.
   * `danger` is destructive and irreversible; it does not confirm on its own.
   * @default "secondary"
   */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** @default "md" */
  size?: Size;
  icon?: IconName;
  /** Which side of the label the icon sits on. @default "start" */
  iconPosition?: Edge;
  /**
   * Shows a spinner and refuses taps. Distinct from `disabled`: this one says
   * "working", and a screen that conflates them leaves the seller unsure
   * whether their tap registered.
   */
  loading?: boolean;
  disabled?: boolean;
  /** Fills its container. Sheets and forms want this; toolbars do not. */
  fullWidth?: boolean;
  /**
   * What a screen reader says, when the visible label is not enough on its own
   * — "Delete" on a row that does not say what it belongs to.
   */
  accessibilityLabel?: string;
  /** Announced after the label, for the consequence: "Cannot be undone". */
  accessibilityHint?: string;
  testID?: string;
};

export function Button({
  label,
  onPress,
  loading,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled ?? loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled ?? loading, busy: loading }}
      testID={testID}
    >
      <RNText>{label}</RNText>
    </Pressable>
  );
}
