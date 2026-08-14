import { Switch as RNSwitch, Text as RNText, View } from "react-native";

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
  disabled,
  busy,
  testID,
}: SwitchProps) {
  return (
    <View testID={testID}>
      <RNText>{label}</RNText>
      {hint ? <RNText>{hint}</RNText> : null}
      <RNSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled ?? busy}
        accessibilityLabel={label}
        accessibilityHint={hint}
      />
    </View>
  );
}
