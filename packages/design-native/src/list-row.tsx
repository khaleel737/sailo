import { useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { IconName } from "./types";
import { Icon } from "./icon";
import { Text } from "./text";

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
  disabled = false,
  destructive = false,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const [pressed, setPressed] = useState(false);

  styles.useVariants({ pressed: pressed && !disabled, disabled });

  /*
   * A row does not scale under the thumb. It sits between hairlines, and
   * shrinking it drags the separators either side in with it — so the press
   * feedback here is the background, which is what iOS does too.
   */
  const body = (
    <View style={styles.row}>
      {icon ? <Icon name={icon} size="md" tone={destructive ? "danger" : "muted"} /> : null}

      <View style={styles.textColumn}>
        <Text variant="body" tone={destructive ? "danger" : "default"} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {value ? (
        <Text variant="callout" tone="muted" align="end" numberOfLines={1}>
          {value}
        </Text>
      ) : null}

      {accessory}

      {/*
       * `chevronEnd` and not a right-pointing one: it means "forward", and
       * forward is leftward in Arabic. The registry mirrors it.
       */}
      {trailing === "chevron" ? <Icon name="chevronEnd" size="sm" tone="muted" /> : null}
    </View>
  );

  if (!onPress) {
    return (
      <View
        style={styles.surface}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      style={styles.surface}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
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

const styles = StyleSheet.create((theme) => ({
  surface: {
    backgroundColor: theme.colors.surface,

    variants: {
      pressed: {
        true: { backgroundColor: theme.colors.surfaceSunken },
        false: {},
      },
      disabled: {
        true: { opacity: theme.components.button.disabledOpacity },
        false: {},
      },
    },
  },
  /*
   * `minHeight`, never `height`. At the largest accessibility text size a
   * two-line title needs three times this, and a fixed height would clip it —
   * see the header of `theme/typography.ts` for why nothing here caps.
   */
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: theme.components.listRow.minHeight,
    paddingHorizontal: theme.components.listRow.paddingInline,
    paddingVertical: theme.components.listRow.paddingBlock,
    gap: theme.components.listRow.gap,
  },
  /*
   * The text column takes what is left after the icon and the trailing slots,
   * and `flexShrink` lets a long value push it rather than overflow the row.
   */
  textColumn: {
    flexGrow: 1,
    flexShrink: 1,
    gap: 2,
  },
}));
