import { ActivityIndicator, Animated, Pressable, View } from "react-native";
import { Icon } from "./icon";
import { Text } from "./text";
import { haptics } from "./haptics";
import { usePressScale } from "./motion";
import { HIT_SLOP, MIN_TAP, ripple, useTheme } from "./theme";
import type { IconName, Edge, Size } from "./types";

/**
 * The thing a seller taps.
 *
 * `label` is a string rather than children, and that is the point: a button
 * whose content is arbitrary JSX is a button somebody eventually puts an
 * untranslated literal inside. One string, from `@sailo/i18n/native`, and the
 * component decides how it is drawn.
 */
export type ButtonProps = {
  label: string;
  onPress: () => void;
  /**
   * `primary` is the one thing this screen wants done — at most one per view.
   * `tonal` is the second-most-important thing: brand-coloured but not filled,
   * for the action a screen offers alongside its primary rather than beneath
   * it. `danger` is destructive and irreversible; it does not confirm on its
   * own.
   * @default "secondary"
   */
  variant?: "primary" | "tonal" | "secondary" | "ghost" | "danger";
  /** @default "md" */
  size?: Size;
  icon?: IconName;
  /** Which side of the label the icon sits on. @default "start" */
  iconPosition?: Edge;
  /**
   * Shows a spinner and refuses taps. Distinct from `disabled`: this one says
   * "working", and a screen that conflates them leaves the seller unsure
   * whether their tap registered.
   */
  loading?: boolean;
  disabled?: boolean;
  /** Fills its container. Sheets and forms want this; toolbars do not. */
  fullWidth?: boolean;
  /**
   * What a screen reader says, when the visible label is not enough on its own
   * — "Delete" on a row that does not say what it belongs to.
   */
  accessibilityLabel?: string;
  /** Announced after the label, for the consequence: "Cannot be undone". */
  accessibilityHint?: string;
  testID?: string;
};

/** Height rather than vertical padding, so a button with an icon and one
 * without are the same height and a row of them shares a baseline. */
const HEIGHTS: Record<Size, number> = { sm: 36, md: MIN_TAP, lg: 52 };

export function Button({
  label,
  onPress,
  variant = "secondary",
  size = "md",
  icon,
  iconPosition = "start",
  loading,
  disabled,
  fullWidth,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const { colors, radius, space } = useTheme();
  /*
   * `||`, never `??`. A caller that passes `disabled={false}` alongside
   * `loading` — which any screen driving both from state does — would keep
   * `false` under `??`, because `??` only falls through on null. The button
   * would then spin and stay tappable, and a seller tapping it again is a
   * second sign-out, a second order write, a second charge.
   */
  const off = disabled || loading;
  const { scale, onPressIn, onPressOut } = usePressScale(!off);

  const skin = {
    primary: {
      bg: colors.accent,
      pressed: colors.accentPressed,
      fg: "inverse" as const,
      border: "transparent",
    },
    tonal: {
      bg: colors.accentSurface,
      pressed: colors.accentBorder,
      fg: "brand" as const,
      border: colors.accentBorder,
    },
    secondary: {
      bg: colors.surface,
      pressed: colors.surfaceSunken,
      fg: "default" as const,
      border: colors.border,
    },
    ghost: {
      bg: "transparent",
      pressed: colors.surfaceSunken,
      fg: "default" as const,
      border: "transparent",
    },
    danger: {
      bg: colors.danger,
      /*
       * A darker red, not the same red.
       *
       * This was `colors.danger` — the identical value it presses *from* — so
       * the one control in the product that deletes things was also the one
       * with no press feedback. On the screen where a seller most needs to know
       * their tap landed, nothing happened. The scale below covers it on iOS,
       * but somebody in Reduce Motion gets no scale either, and then the fill
       * is all there is.
       */
      pressed: colors.dangerPressed,
      fg: "inverse" as const,
      border: "transparent",
    },
  }[variant];

  return (
    /*
     * The scale lives on a wrapper rather than on the `Pressable` itself.
     *
     * `Pressable`'s `style` callback runs on the JS thread on every press
     * frame; an `Animated.View` around it runs the same transform on the
     * compositor. The difference is invisible on an idle screen and very
     * visible on a list that is still settling — which is exactly when
     * somebody presses something.
     */
    <Animated.View
      style={{
        transform: [{ scale }],
        alignSelf: fullWidth ? "stretch" : "flex-start",
      }}
    >
      <Pressable
        onPress={() => {
          /* Feedback belongs to the control, not to the forty screens that use
             it. Before this, three screens buzzed after a write and no button
             in the app buzzed at all — so the seller learned the buzz meant
             "it worked" and then tapped something that worked silently. */
          haptics.tap();
          onPress();
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={off}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: off, busy: loading }}
        /* Android draws its own ripple and ignores the `pressed` style unless
           one is configured — so without this, Android users get the scale and
           nothing else, on a platform whose users read the ripple as "the tap
           registered". */
        android_ripple={ripple(
          variant === "primary" || variant === "danger"
            ? "rgba(255, 255, 255, 0.24)"
            : colors.accentSurface,
        )}
        testID={testID}
        style={({ pressed }) => ({
          minHeight: HEIGHTS[size],
          paddingHorizontal: size === "sm" ? space.md : space.lg,
          borderRadius: radius.xl,
          // Superellipse rather than a circular arc — the iOS corner shape. The
          // difference is small per corner and unmistakable across a screen.
          borderCurve: "continuous",
          borderWidth: skin.border === "transparent" ? 0 : 1,
          borderColor: skin.border,
          backgroundColor: pressed && !off ? skin.pressed : skin.bg,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          opacity: off ? 0.4 : 1,
        })}
      >
        {loading ? (
          <ActivityIndicator
            color={
              variant === "primary" || variant === "danger"
                ? colors.contentInverse
                : variant === "tonal"
                  ? colors.accent
                  : colors.content
            }
          />
        ) : (
          <View
            style={{
              flexDirection: iconPosition === "end" ? "row-reverse" : "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            {icon ? <Icon name={icon} size={size} tone={skin.fg} /> : null}
            <Text variant={size === "sm" ? "callout" : "body"} weight="semibold" tone={skin.fg}>
              {label}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
