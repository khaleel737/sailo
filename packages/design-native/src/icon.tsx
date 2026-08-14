import { Text as RNText } from "react-native";
import type { IconName, Size, Tone } from "./types.ts";

/**
 * A glyph, named for what it means rather than for what it is called on this
 * platform.
 *
 * The mapping from `name` to an SF Symbol on iOS and a vector on Android lives
 * inside this package. A screen that wrote `sf="cart.fill"` would be a screen
 * that has to be edited again for Android, and edited a third time when Apple
 * renames a symbol.
 *
 * `accessibilityLabel` is optional and usually wrong to set. An icon beside a
 * label is decoration and should be silent; only an icon that *is* the control
 * — a bare close button — needs a name of its own.
 */
export type IconProps = {
  name: IconName;
  /** @default "md" */
  size?: Size;
  /** @default "default" */
  tone?: Tone;
  /** Set only when this icon carries meaning no nearby text repeats. */
  accessibilityLabel?: string;
  testID?: string;
};

export function Icon({ name, accessibilityLabel, testID }: IconProps) {
  return (
    <RNText
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? "yes" : "no-hide-descendants"}
      testID={testID}
    >
      {name}
    </RNText>
  );
}
