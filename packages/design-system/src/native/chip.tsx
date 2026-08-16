import { Animated, Pressable } from "react-native";
import { Icon } from "./icon";
import { Text } from "./text";
import { haptics } from "./haptics";
import { usePressScale } from "./motion";
import { MIN_TAP, ripple, useTheme } from "./theme";
import type { IconName } from "./types";

/**
 * A filter you can turn on.
 *
 * Distinct from `Segmented`, and the difference is arity rather than looks.
 * A segmented control is *one of N* — it always has an answer, and picking a
 * new one un-picks the old. Chips are *any of N*, including none, which is what
 * a filter row over a list of orders actually is. Using a segmented control for
 * that is how "All" ends up as an option, and "All" is a value that has to be
 * special-cased in every query it reaches.
 */
export type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** A leading glyph — the category, the status colour. */
  icon?: IconName;
  /** A trailing count, when the chip knows how much it would show. */
  count?: number;
  disabled?: boolean;
  testID?: string;
};

export function Chip({ label, selected, onPress, icon, count, disabled, testID }: ChipProps) {
  const { colors, space } = useTheme();
  const { scale, onPressIn, onPressOut } = usePressScale(!disabled);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={() => {
          /* `selection`, not `tap`: the value under the control changed, which
             is a different sensation from a button being pressed, and both
             platforms render it differently on purpose. */
          haptics.selection();
          onPress();
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        /*
         * A checkbox, not a button, and the role is load-bearing.
         *
         * VoiceOver announces a button as "Unpaid, button" — which says nothing
         * about whether the filter is currently on. As a checkbox it is
         * "Unpaid, checked", and that is the only thing a seller listening to
         * a filter row actually needs to know.
         */
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked: selected, disabled: Boolean(disabled) }}
        android_ripple={ripple(colors.accentSurface)}
        testID={testID}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          /*
           * The floor, which this was the one interactive component in the
           * package to be missing.
           *
           * `paddingVertical: space.sm` is 8pt each side, so a chip came out
           * around 36pt tall — under the 44 that `ListRow`, `Switch`, `Button`
           * and `TextField` all hold themselves to via this same constant. It
           * matters more here than the number suggests: chips are drawn in a
           * row, so the miss is not "nothing happened", it is the wrong filter
           * turning on next to the one that was meant.
           *
           * `minHeight` rather than a bigger padding, so a chip whose label
           * wraps still grows, and a chip on a screen with Dynamic Type turned
           * up is not clipped to a fixed 44.
           */
          minHeight: MIN_TAP,
          gap: space.xs,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          /* A capsule, so no `borderCurve` — that shapes a rounded rectangle
             and does nothing on a full-radius shape. */
          borderRadius: 999,
          borderWidth: 1,
          borderColor: selected ? colors.accent : colors.border,
          backgroundColor: selected
            ? colors.accent
            : pressed
              ? colors.surfaceSunken
              : colors.surface,
          opacity: disabled ? 0.4 : 1,
        })}
      >
        {icon ? <Icon name={icon} size="sm" tone={selected ? "inverse" : "muted"} /> : null}
        <Text variant="callout" weight="medium" tone={selected ? "inverse" : "default"}>
          {label}
        </Text>
        {typeof count === "number" ? (
          /* `numeric` so a row of chips does not reflow as the counts change
             under a live query — which they do, on every refetch. */
          <Text variant="caption" tone={selected ? "inverse" : "muted"}>
            {String(count)}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
