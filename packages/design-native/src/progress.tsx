import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { fadeTiming } from "./theme/motion";
import { Text } from "./text";

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
  /*
   * Clamped, and `valueLabel` still shows — so a caller who hands this 1.4
   * because their denominator was stale gets a full bar next to whatever they
   * said the count was, rather than a fill running out of its own track.
   */
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

  const progress = useSharedValue(clamped);
  useEffect(() => {
    /* On the UI thread, and `ReduceMotion.System` in the config skips it. */
    progress.value = withTiming(clamped, fadeTiming);
  }, [clamped, progress]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  styles.useVariants({ tone, size });

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      /*
       * `now` is the clamped value, because that is what is drawn. Announcing
       * 1.4 to a screen reader while the bar shows full would be the one
       * reader who is told something different from everybody else.
       */
      accessibilityValue={{ min: 0, max: 1, now: clamped }}
      testID={testID}
    >
      {label || valueLabel ? (
        <View style={styles.labels}>
          {label ? (
            <Text variant="caption" tone="muted">
              {label}
            </Text>
          ) : null}
          {/*
           * The count sits at the trailing edge, which `justifyContent:
           * space-between` on a mirroring row puts on the correct side in
           * Arabic without either of them naming a side.
           */}
          {valueLabel ? (
            <Text variant="caption" tone="muted" weight="medium">
              {valueLabel}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.track}>
        <Animated.View style={[styles.fill, fill]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.space.xs,
    alignSelf: "stretch",
  },
  labels: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
  },
  track: {
    overflow: "hidden",
    borderRadius: theme.components.progress.radius,
    backgroundColor: theme.colors.surfaceSunken,

    variants: {
      size: {
        sm: { height: theme.components.progress.track.sm },
        md: { height: theme.components.progress.track.md },
      },
    },
  },
  /*
   * The fill grows from the leading edge. `alignItems: flex-start` on the
   * track would do it too, but an explicit `start` says which edge is meant
   * and mirrors on its own.
   */
  fill: {
    height: "100%",
    borderRadius: theme.components.progress.radius,

    variants: {
      tone: {
        brand: { backgroundColor: theme.colors.accent },
        neutral: { backgroundColor: theme.colors.contentMuted },
      },
    },
  },
}));
