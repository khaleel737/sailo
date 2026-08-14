import { Animated, Pressable, View } from "react-native";
import { haptics } from "./haptics";
import { usePressScale } from "./motion";
import { ripple, useTheme } from "./theme";

/**
 * A surface that groups things.
 *
 * `onPress` is what turns it into a control: passing one makes the whole card
 * tappable and gives it a button role, so a screen never has to wrap a card in
 * its own `Pressable` and lose the press feedback the theme provides.
 */
export type CardProps = {
  children: React.ReactNode;
  /**
   * `plain` has no edge and no fill — a grouping that costs nothing visually,
   * for when a card is the wrong amount of furniture. `elevated` is for
   * something floating above the page; reserve it, because two elevations on
   * one screen is one too many. `tinted` is the brand-coloured block a screen
   * opens with, and there is at most one of those per screen. `inverse` is the
   * one block on the whole surface that flips the page — Home's shop link — and
   * there is at most one of those in the *product*.
   *
   * **Content inside an `inverse` card must pass `tone="inverse"`.** The card
   * cannot set it for them: React Native has no cascading colour, and a `Text`
   * that inherits nothing draws in the ink it was told to. This is the one
   * variant with a rule attached, which is also the reason there is exactly one
   * place in the app that uses it.
   * @default "outlined"
   */
  variant?: "plain" | "outlined" | "elevated" | "tinted" | "inverse";
  /** @default "md" */
  padding?: "none" | "sm" | "md" | "lg";
  /** Makes the whole card a control. */
  onPress?: () => void;
  /** Required when `onPress` is set and the card's content is not a sentence. */
  accessibilityLabel?: string;
  testID?: string;
};

export function Card({
  children,
  variant = "outlined",
  padding = "md",
  onPress,
  accessibilityLabel,
  testID,
}: CardProps) {
  const { colors, radius, space, shadow } = useTheme();
  const { scale, onPressIn, onPressOut } = usePressScale(Boolean(onPress));

  const pad = { none: 0, sm: space.sm, md: space.md, lg: space.lg }[padding];

  /*
   * The four skins, and the one that used to not exist.
   *
   * `plain` read `variant === "plain" ? colors.surface : colors.surface` — the
   * same value on both arms of the ternary, so a `plain` card was an `outlined`
   * card minus its border, which is not what "plain" means anywhere else in the
   * product. It is a *bare group*: no fill, no edge, just the padding and the
   * gap. The screens that wanted one were reaching for a raw `View` instead,
   * which is how six of them ended up with their own spacing.
   */
  const skin = {
    plain: {
      bg: "transparent",
      pressed: colors.surfaceSunken,
      border: 0,
      borderColor: "transparent",
      elevation: shadow.none,
    },
    outlined: {
      bg: colors.surface,
      pressed: colors.surfaceSunken,
      border: 1,
      borderColor: colors.border,
      elevation: shadow.none,
    },
    elevated: {
      bg: colors.surfaceElevated,
      pressed: colors.surfaceSunken,
      border: 0,
      borderColor: "transparent",
      elevation: shadow.card,
    },
    tinted: {
      bg: colors.accentSurface,
      /* A tinted card presses towards its own accent, not towards the neutral
         ramp — pressing a green block to grey reads as it switching off. */
      pressed: colors.accentBorder,
      border: 1,
      borderColor: colors.accentBorder,
      elevation: shadow.none,
    },
    inverse: {
      bg: colors.surfaceInverse,
      /* Nowhere lighter to go on a near-black block, so it presses towards the
         ink one step up the ramp — which is the direction the eye reads as
         "held down" on a dark surface. */
      pressed: colors.content,
      border: 0,
      borderColor: "transparent",
      elevation: shadow.none,
    },
  }[variant];

  const base = {
    backgroundColor: skin.bg,
    borderRadius: radius["2xl"],
    // The iOS corner shape. Small per corner, unmistakable across a screen.
    borderCurve: "continuous" as const,
    borderWidth: skin.border,
    borderColor: skin.borderColor,
    padding: pad,
    gap: space.sm,
    /* `undefined` in dark mode, where a shadow is an absence of light on a page
       that has none. `elevated` separates by lifting its fill there instead —
       see the note on `shadow` in `theme.ts`. */
    ...(skin.elevation ? { boxShadow: skin.elevation } : null),
  };

  if (!onPress) {
    return (
      <View style={base} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        android_ripple={ripple(colors.accentSurface)}
        testID={testID}
        style={({ pressed }) => [
          base,
          /*
           * A fill change *as well as* the scale, and shallower than it was.
           *
           * The old value was `opacity: 0.7` on the whole card, which fades the
           * text as well as the surface and reads as the card being disabled
           * rather than pressed. Tinting the surface leaves the content at full
           * contrast, which is what a press looks like on both platforms.
           */
          pressed ? { backgroundColor: skin.pressed } : null,
        ]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
