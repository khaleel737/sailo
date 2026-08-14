import { Switch as RNSwitch, View } from "react-native";
import { Text } from "./text";
import { MIN_TAP, useTheme } from "./theme";

/**
 * A setting that is on or off.
 *
 * `label` is required and belongs to the component rather than to the row
 * around it, because a switch on its own announces "off" and nothing else. The
 * label is also the tap target: the theme wires the two together so a seller
 * does not have to hit a 50pt control with their thumb.
 */
export type SwitchProps = {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label: string;
  /**
   * The line under it. This is where a component says why it is unavailable —
   * "Notifications are off in Settings" — rather than leaving a disabled
   * control with no explanation.
   */
  hint?: string;
  disabled?: boolean;
  /** Refuses taps and shows activity, for a toggle that writes to a server. */
  busy?: boolean;
  testID?: string;
};

export function Switch({ value, onValueChange, label, hint, disabled, busy, testID }: SwitchProps) {
  const { colors, space, dark } = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        minHeight: MIN_TAP,
      }}
      testID={testID}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      {/*
        The platform control, not a drawn one. It carries the system's own
        animation, its haptic on iOS, and whatever the accessibility settings
        have done to it — none of which a hand-rolled toggle inherits.
      */}
      <RNSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled || busy}
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: disabled || busy, checked: value, busy }}
        trackColor={{ true: colors.accent, false: colors.border }}
        /*
         * Three colour props for one control, because the two platforms draw
         * it out of different parts.
         *
         * iOS renders the off state as the *container's* colour showing through
         * a translucent track, so `trackColor.false` alone leaves a white pill
         * on a dark page — `ios_backgroundColor` is what paints underneath.
         * Android draws a separate thumb that defaults to a light grey, which
         * on Sailo's dark surface is fine and on its light one is invisible
         * against `border`; setting it explicitly is what makes the two
         * platforms agree about which state is which.
         */
        ios_backgroundColor={colors.border}
        /*
         * White when on, in both modes, because in both modes the thumb is
         * sitting on a saturated green. Off, it takes whatever reads as
         * "raised" against `border` — white on the light page, and the muted
         * ink on the dark one, where a white-ish thumb would be the brightest
         * thing on the screen for a control that is switched off.
         *
         * Ignored on iOS, which draws its own.
         */
        thumbColor={value ? "#ffffff" : dark ? colors.contentMuted : "#ffffff"}
      />
    </View>
  );
}
