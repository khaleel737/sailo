import { Pressable, Text as RNText, View } from "react-native";
import type { IconName } from "./types.ts";

/**
 * One line in a list — the shape most of this app is made of.
 *
 * The slots are named rather than free-form so every row in the product lines
 * up down the screen: `value` is always the trailing text, `accessory` is
 * always the thing after it. A row that took children would let each screen
 * invent its own column widths.
 */
export type ListRowProps = {
  title: string;
  /** The second line — who ordered it, when, what state it is in. */
  subtitle?: string;
  /** Trailing text. Amounts, counts, dates. Formatted by the caller. */
  value?: string;
  /** Leading icon. */
  icon?: IconName;
  /**
   * A slot after `value`, for something the row cannot express as text — a
   * `StatusPill`, a `Switch`, an `Avatar`. Anything else belongs in a prop.
   */
  accessory?: React.ReactNode;
  /**
   * The disclosure chevron. Set it when the row pushes a screen; leaving it on
   * a row that only toggles something promises a detail view that isn't there.
   * @default "none"
   */
  trailing?: "chevron" | "none";
  onPress?: () => void;
  disabled?: boolean;
  /** Draws the title in the danger tone. Sign out, delete account. */
  destructive?: boolean;
  /**
   * Read instead of `title` + `subtitle` when the two only make sense together
   * — "Order 4831, Amina, confirmed, 240 AED".
   */
  accessibilityLabel?: string;
  testID?: string;
};

export function ListRow({
  title,
  subtitle,
  value,
  accessory,
  onPress,
  disabled,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const body = (
    <View>
      <RNText>{title}</RNText>
      {subtitle ? <RNText>{subtitle}</RNText> : null}
      {value ? <RNText>{value}</RNText> : null}
      {accessory}
    </View>
  );

  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}
