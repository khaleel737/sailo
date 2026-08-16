import { useState } from "react";
import { Animated, I18nManager, Pressable, View, type LayoutChangeEvent } from "react-native";
import { Text } from "./text";
import { haptics } from "./haptics";
import { useAnimatedNumber, useReducedMotion } from "./motion";
import { useTheme } from "./theme";

/** One choice in a `Segmented`. */
export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** A count beside the label — "Open 4". Omit rather than showing a zero. */
  badge?: string;
};

/**
 * A row of mutually exclusive choices — a filter, a range, a mode.
 *
 * Generic in the value so a screen gets `OrderStatus` back from `onChange`
 * rather than `string`, and a segment for a status that no longer exists is a
 * compile error instead of a filter that silently matches nothing.
 *
 * For three or four options. Beyond that the segments stop being readable and
 * the answer is a `Sheet` with a list in it, not a smaller font.
 */
export type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  /** What the group as a whole selects — "Filter orders by status". */
  accessibilityLabel: string;
  testID?: string;
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  accessibilityLabel,
  testID,
}: SegmentedProps<T>) {
  const { colors, radius, space, shadow } = useTheme();
  const reduced = useReducedMotion();

  /*
   * The track's measured width, which is the one thing this control cannot
   * know in advance.
   *
   * A thumb positioned with `flex` would be laid out by the flexbox engine and
   * therefore could not animate — layout is not an animatable property. So the
   * track measures itself once, and the thumb is an absolutely-positioned view
   * whose `translateX` is arithmetic on that number. Zero until the first
   * layout pass, which is the frame before anything is visible.
   */
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const segment = options.length > 0 ? trackWidth / options.length : 0;

  /*
   * The thumb's travel, signed for the writing direction.
   *
   * `insetInlineStart` puts the thumb against the leading edge, which Arabic
   * flips to the right — but `translateX` is *physical* and knows nothing about
   * direction, so the same positive offset that walks the thumb rightwards in
   * English walks it off the end of the track in Arabic. This is the one place
   * in the package where a logical property and a transform have to be
   * reconciled by hand, because there is no logical `translate`.
   */
  const direction = I18nManager.isRTL ? -1 : 1;
  const target = segment * index * direction;
  const offset = useAnimatedNumber(target, { native: true });

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onLayout={(event: LayoutChangeEvent) => {
        /* Minus the 2pt inset on each side, so the thumb lands inside the
           track rather than over its edge. */
        setTrackWidth(Math.max(0, event.nativeEvent.layout.width - 4));
      }}
      style={{
        flexDirection: "row",
        backgroundColor: colors.surfaceSunken,
        borderRadius: radius.xl,
        borderCurve: "continuous",
        padding: 2,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {/*
        One thumb that slides, rather than a background that appears under
        whichever segment is selected.

        The old version painted `backgroundColor` on the selected `Pressable`,
        so switching filters was a cut — the chip vanished from one segment and
        appeared under another. A control whose selection *travels* is the iOS
        idiom, and it is also the thing that tells a seller which direction
        they moved, which a cut cannot.
      */}
      {segment > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 2,
            bottom: 2,
            insetInlineStart: 2,
            width: segment,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            backgroundColor: colors.surface,
            /* From the theme, so dark mode gets none — a shadow on a dark
               ground is invisible, and the raised-chip idiom is carried there
               by the fill being lighter than the track instead. */
            ...(shadow.card ? { boxShadow: shadow.card } : null),
            transform: [{ translateX: reduced ? target : offset }],
          }}
        />
      ) : null}

      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            disabled={disabled}
            onPress={() => {
              if (selected) return;
              /* `selection`, not `tap`. The value under the control changed —
                 both platforms render that differently from a button press,
                 and the difference is the whole vocabulary. */
              haptics.selection();
              onChange(option.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: Boolean(disabled) }}
            style={{
              flex: 1,
              minHeight: 32,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: space.xs,
            }}
          >
            <Text
              variant="callout"
              weight={selected ? "semibold" : "regular"}
              tone={selected ? "default" : "muted"}
              numberOfLines={1}
            >
              {option.label}
            </Text>
            {option.badge ? (
              <Text variant="caption" tone="muted">
                {option.badge}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
