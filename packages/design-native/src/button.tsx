import { useState } from "react";
import { ActivityIndicator, Pressable } from "react-native";
import Animated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import type { IconName, Edge, Size, Tone } from "./types";
import { Icon } from "./icon";
import { Text } from "./text";
import { components, slopTo } from "./theme/components";
import { usePressMotion } from "./theme/motion";
import { useToneColor } from "./theme/tone-color";

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
   * `danger` is destructive and irreversible; it does not confirm on its own.
   * @default "secondary"
   */
  variant?: "primary" | "secondary" | "ghost" | "danger";
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

/**
 * What the label and icon are drawn in, per fill.
 *
 * A table rather than a conditional inside the render, because the spinner, the
 * icon and the text all have to agree and three separate ternaries is three
 * places for them to stop agreeing. `inverse` is the palette's "ink that reads
 * on a saturated ground", which is why both filled variants use it.
 */
const CONTENT_TONE = {
  primary: "inverse",
  secondary: "default",
  ghost: "brand",
  danger: "inverse",
} as const satisfies Record<NonNullable<ButtonProps["variant"]>, Tone>;

export function Button({
  label,
  onPress,
  variant = "secondary",
  size = "md",
  icon,
  iconPosition = "start",
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const motion = usePressMotion();

  const inert = disabled || loading;
  const tone = CONTENT_TONE[variant];
  const spinnerColor = useToneColor(tone);

  /*
   * Press, disabled and focus are variants rather than styles chosen in the
   * render, so that "what a pressed danger button looks like" is one entry in
   * one stylesheet instead of a conditional that has to be repeated for the
   * border, the fill and the shadow.
   */
  styles.useVariants({
    variant,
    size,
    fullWidth,
    pressed: pressed && !inert,
    disabled: inert,
    focused,
  });

  return (
    <Animated.View style={[styles.wrapper, motion.style]}>
      <Pressable
        style={styles.button}
        onPress={onPress}
        onPressIn={() => {
          setPressed(true);
          motion.onPressIn();
        }}
        onPressOut={() => {
          setPressed(false);
          motion.onPressOut();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={inert}
        /*
         * `sm` draws at 36pt and is tapped at 44 — the shortfall comes back as
         * slop rather than as a taller button, because the toolbars that ask
         * for `sm` asked for it to be short. See `theme/components.ts`.
         */
        hitSlop={slopTo(components.button.height[size])}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inert, busy: loading }}
        testID={testID}
      >
        {/*
         * The spinner takes the icon's place rather than the label's, so the
         * button does not change width the moment it is tapped — a button that
         * resizes under the thumb reads as a mis-tap.
         */}
        {loading ? (
          <ActivityIndicator size="small" color={spinnerColor} />
        ) : icon && iconPosition === "start" ? (
          <Icon name={icon} size={size === "lg" ? "lg" : "sm"} tone={tone} />
        ) : null}

        <Text variant={size === "sm" ? "caption" : "body"} weight="semibold" tone={tone}>
          {label}
        </Text>

        {!loading && icon && iconPosition === "end" ? (
          <Icon name={icon} size={size === "lg" ? "lg" : "sm"} tone={tone} />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  /*
   * The scale lives on a wrapper rather than on the `Pressable` itself. A
   * transform on the pressable would scale its touch target with it, so the
   * area a finger has to hit shrinks at exactly the moment the finger is
   * already on its way down.
   */
  wrapper: {
    variants: {
      fullWidth: {
        true: { alignSelf: "stretch" },
        false: { alignSelf: "flex-start" },
      },
    },
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.components.button.gap,
    borderRadius: theme.components.button.radius,
    borderWidth: 1,
    borderColor: "transparent",

    variants: {
      variant: {
        primary: {
          backgroundColor: theme.colors.accent,
        },
        secondary: {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        ghost: {
          backgroundColor: "transparent",
        },
        danger: {
          backgroundColor: theme.colors.dangerSurface,
        },
      },
      size: {
        sm: {
          minHeight: theme.components.button.height.sm,
          paddingHorizontal: theme.components.button.paddingInline.sm,
        },
        md: {
          minHeight: theme.components.button.height.md,
          paddingHorizontal: theme.components.button.paddingInline.md,
        },
        lg: {
          minHeight: theme.components.button.height.lg,
          paddingHorizontal: theme.components.button.paddingInline.lg,
        },
      },
      fullWidth: {
        true: { alignSelf: "stretch" },
        false: {},
      },
      /*
       * Pressed darkens the fill rather than fading the whole control. Opacity
       * would take the label with it, and a label that dims on press reads as
       * the button becoming unavailable.
       */
      pressed: {
        true: {},
        false: {},
      },
      disabled: {
        true: { opacity: theme.components.button.disabledOpacity },
        false: {},
      },
      focused: {
        true: {
          borderColor: theme.colors.focus,
          borderWidth: theme.components.button.focusWidth,
        },
        false: {},
      },
    },

    /*
     * The pressed fill has to know which fill it is darkening, which is what
     * compound variants are for — and why this is not four `pressed` entries
     * fighting over one `backgroundColor`.
     */
    compoundVariants: [
      {
        variant: "primary",
        pressed: true,
        styles: { backgroundColor: theme.colors.accentPressed },
      },
      {
        variant: "secondary",
        pressed: true,
        styles: { backgroundColor: theme.colors.surfaceSunken },
      },
      {
        variant: "ghost",
        pressed: true,
        styles: { backgroundColor: theme.colors.accentSubtle },
      },
      {
        variant: "danger",
        pressed: true,
        styles: { backgroundColor: theme.colors.danger, opacity: 0.88 },
      },
    ],
  },
}));
