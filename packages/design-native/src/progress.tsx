import { Text as RNText, View } from "react-native";

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
  accessibilityLabel,
  testID,
}: ProgressProps) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 1, now: clamped }}
      testID={testID}
    >
      {label ? <RNText>{label}</RNText> : null}
      {valueLabel ? <RNText>{valueLabel}</RNText> : null}
    </View>
  );
}
