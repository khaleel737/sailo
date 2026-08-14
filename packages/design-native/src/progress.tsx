import { Animated, View } from "react-native";
import { Text } from "./text";
import { useAnimatedNumber } from "./motion";
import { useTheme } from "./theme";

/**
 * How far through something is.
 *
 * `accessibilityLabel` is required, not optional. A progress bar is the one
 * control with no text of its own, so a screen reader on an unlabelled one
 * announces a percentage of nothing.
 */
export type ProgressProps = {
  /** 0–1. Values outside the range are clamped, and `valueLabel` still shows. */
  value: number;
  /** What is progressing, drawn above the bar. */
  label?: string;
  /** The count in words — "2 of 4". Drawn at the end of the label row. */
  valueLabel?: string;
  /** @default "brand" */
  tone?: "brand" | "neutral";
  /** @default "md" */
  size?: "sm" | "md";
  accessibilityLabel: string;
  testID?: string;
};

export function Progress({
  value,
  label,
  valueLabel,
  tone = "brand",
  size = "md",
  accessibilityLabel,
  testID,
}: ProgressProps) {
  const { colors, space } = useTheme();
  // Clamped rather than trusted: a caller computing done/total hands this a
  // NaN the first time total is zero, and NaN% is a bar of undefined width.
  const ratio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const height = size === "sm" ? 4 : 8;

  /*
   * The fill grows rather than jumps.
   *
   * This is the onboarding checklist's bar, so the value changes at exactly the
   * moment a seller has just finished a step — and a bar that snaps to its new
   * length gives them nothing to see for the thing they just did. `flex` on a
   * fraction rather than a percentage width, because a percentage is a layout
   * property that the animated driver has to recompute on the JS thread every
   * frame, while two flex weights either side of the fill are resolved once by
   * the layout engine.
   *
   * `useAnimatedNumber` does not animate its *first* value, which is the other
   * half of the same argument: a checklist that is already three-quarters done
   * should be three-quarters done when the screen opens, not fill up on every
   * visit as though the seller had just earned it.
   */
  const filled = useAnimatedNumber(ratio);

  return (
    <View style={{ gap: space.xs }} testID={testID}>
      {label || valueLabel ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
          {label ? (
            <Text variant="caption" tone="muted">
              {label}
            </Text>
          ) : null}
          {valueLabel ? (
            <Text variant="caption" tone="muted">
              {valueLabel}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View
        /*
         * `accessible` is what makes this one element to a screen reader rather
         * than a container of two anonymous views. Without it the role and the
         * value below are set on something VoiceOver never stops on, so the bar
         * is announced as nothing at all — which is the same as not having
         * labelled it.
         */
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
        style={{
          height,
          borderRadius: 999,
          backgroundColor: colors.surfaceSunken,
          overflow: "hidden",
          /* Two children sharing the track by weight — see `filled` above for
             why this is flex rather than a percentage width. */
          flexDirection: "row",
        }}
      >
        <Animated.View
          style={{
            flex: filled,
            borderRadius: 999,
            backgroundColor: tone === "brand" ? colors.accent : colors.contentMuted,
          }}
        />
        {/* The remainder. Transparent, so the track's own colour shows
            through — it exists only to give the fill something to push
            against. */}
        <Animated.View style={{ flex: Animated.subtract(1, filled) }} />
      </View>
    </View>
  );
}
