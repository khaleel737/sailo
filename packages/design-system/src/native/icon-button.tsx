import { Animated, Pressable } from "react-native";
import { Icon } from "./icon";
import { haptics } from "./haptics";
import { usePressScale } from "./motion";
import { HIT_SLOP, MIN_TAP, ripple, useTheme } from "./theme";
import type { IconName, Size, Tone } from "./types";

/**
 * A control that is only a glyph — a close, a refresh, a share in a toolbar.
 *
 * **`accessibilityLabel` is required, and it is the whole reason this is a
 * component rather than an `Icon` inside a `Pressable`.** An icon-only button
 * with no label is a button VoiceOver announces as "button" and nothing else,
 * and the seller has no way to find out what it does short of pressing it.
 * `Icon` deliberately makes its own label optional — an icon beside text is
 * decoration and should be silent — so the requirement has to live here, in the
 * one place the icon *is* the control.
 */
export type IconButtonProps = {
  icon: IconName;
  onPress: () => void;
  /** What a screen reader says. Required — see above. */
  accessibilityLabel: string;
  /** Announced after the label, for the consequence. */
  accessibilityHint?: string;
  /**
   * `plain` is a bare glyph; `tinted` sits on a soft fill and is for the one
   * icon-only action a screen wants noticed.
   * @default "plain"
   */
  variant?: "plain" | "tinted";
  /** @default "md" */
  size?: Size;
  /** @default "default" */
  tone?: Tone;
  disabled?: boolean;
  testID?: string;
};

/** The tap target, which is larger than the glyph at every size. */
const TARGETS: Record<Size, number> = { sm: 32, md: MIN_TAP, lg: 52 };

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  variant = "plain",
  size = "md",
  tone = "default",
  disabled,
  testID,
}: IconButtonProps) {
  const { colors, radius } = useTheme();
  const { scale, onPressIn, onPressOut } = usePressScale(!disabled);

  const tinted = variant === "tinted";

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        /* The glyph is small even when the target is not; hit slop is what
           keeps a 32pt toolbar button reachable with a thumb. */
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: Boolean(disabled) }}
        android_ripple={ripple(colors.accentSurface, !tinted)}
        testID={testID}
        style={({ pressed }) => ({
          width: TARGETS[size],
          height: TARGETS[size],
          alignItems: "center",
          justifyContent: "center",
          borderRadius: tinted ? radius.lg : 999,
          borderCurve: "continuous",
          backgroundColor: tinted
            ? pressed
              ? colors.surfaceSunken
              : colors.accentSurface
            : "transparent",
          opacity: disabled ? 0.4 : 1,
        })}
      >
        <Icon name={icon} size={size} tone={tinted && tone === "default" ? "brand" : tone} />
      </Pressable>
    </Animated.View>
  );
}
