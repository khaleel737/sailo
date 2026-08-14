import { useState } from "react";
import { ActivityIndicator, Pressable, Switch as RNSwitch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "./text";

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

export function Switch({
  value,
  onValueChange,
  label,
  hint,
  disabled = false,
  busy = false,
  testID,
}: SwitchProps) {
  const { theme } = useUnistyles();
  const [pressed, setPressed] = useState(false);
  const inert = disabled || busy;

  styles.useVariants({ pressed: pressed && !inert, disabled: inert });

  return (
    /*
     * The whole row is the control, which is the point of `label` living here.
     * `accessibilityRole="switch"` plus `checked` means a screen reader reads
     * the label and the state as one thing and toggles on a double-tap — the
     * bare `RNSwitch` beside a `Text` announces "off" and leaves the reader to
     * work out what is off.
     */
    <Pressable
      style={styles.row}
      onPress={() => onValueChange(!value)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={inert}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled: inert, busy }}
      testID={testID}
    >
      <View style={styles.text}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>

      {busy ? <ActivityIndicator size="small" color={theme.colors.contentMuted} /> : null}

      {/*
       * The switch itself is hidden from the reader — the row above already
       * carries the role, the label and the state, and leaving this focusable
       * gives a VoiceOver user two stops for one setting.
       *
       * `pointerEvents="none"` for the same reason on the touch side: the row
       * handles the tap, and letting the thumb-sized control handle its own
       * would mean the 44pt target only applies to the parts of the row that
       * are not the switch.
       */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <RNSwitch
          value={value}
          onValueChange={onValueChange}
          disabled={inert}
          trackColor={{ true: theme.colors.accent, false: theme.colors.surfaceSunken }}
          thumbColor={theme.colors.surface}
          ios_backgroundColor={theme.colors.surfaceSunken}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.components.listRow.gap,
    minHeight: theme.components.listRow.minHeight,
    paddingHorizontal: theme.components.listRow.paddingInline,
    paddingVertical: theme.components.listRow.paddingBlock,
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
  text: {
    flexGrow: 1,
    flexShrink: 1,
    gap: 2,
  },
}));
