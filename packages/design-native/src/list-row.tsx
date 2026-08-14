import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "./icon";
import { Text } from "./text";
import { haptics } from "./haptics";
import { MIN_TAP, ripple, useTheme } from "./theme";
import type { IconName } from "./types";

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
  icon,
  accessory,
  trailing = "none",
  onPress,
  disabled,
  destructive,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const { colors, space } = useTheme();

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        minHeight: MIN_TAP,
        // Drawn by every row and clipped off the last one by the group's
        // `overflow: hidden`, so no row has to know whether it is last.
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.borderSubtle,
      }}
    >
      {icon ? <Icon name={icon} tone={destructive ? "danger" : "muted"} /> : null}

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" tone={destructive ? "danger" : "default"} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {value ? (
        /* `numeric`, because this slot is overwhelmingly an amount or a count.
           A column of trailing values in proportional figures reflows every
           time one of them changes under a refetch — which, on the orders
           list, is every thirty seconds. */
        <Text variant="numeric" tone="muted" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {accessory}
      {trailing === "chevron" ? <Icon name="chevronEnd" size="sm" tone="muted" /> : null}
    </View>
  );

  if (!onPress) return <View testID={testID}>{content}</View>;

  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      android_ripple={ripple(colors.accentSurface)}
      testID={testID}
      /*
       * A highlight, not a scale.
       *
       * Every other control in the package shrinks under a finger; a row in a
       * list does not, and the reason is that a row has no edges of its own —
       * scaling it makes the hairlines above and below it visibly separate from
       * their neighbours, so pressing one row appears to move three. The
       * platform's own tables highlight instead, and this matches them.
       */
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfaceSunken : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {content}
    </Pressable>
  );
}
