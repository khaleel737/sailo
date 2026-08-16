import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./icon";
import { Text } from "./text";
import { ease, useReducedMotion } from "./motion";
import { HIT_SLOP, MIN_TAP, useTheme } from "./theme";
import type { IconName, StatusTone } from "./types";

/**
 * A message that appears, says one thing, and goes away.
 *
 * Controlled by the screen, like `Sheet`. That is a deliberate limit on what a
 * toast can be used for: something a screen has to hold state for is something
 * a screen has thought about, and the alternative — a global `toast.show()`
 * anything can call from anywhere — is how an app ends up telling the seller
 * "Saved" over the top of the error that says it wasn't.
 *
 * A toast is never the only place a failure appears. It is dismissible, it
 * times out, and a seller looking away misses it entirely — so the error that
 * matters also belongs next to the control that caused it. `Banner` is that
 * other place.
 */
export type ToastProps = {
  visible: boolean;
  message: string;
  /** @default "neutral" */
  tone?: StatusTone;
  /**
   * One thing to do about it — "Undo", "Retry". Tapping it does not dismiss;
   * call `onDismiss` from the handler if that is what should happen.
   */
  action?: { label: string; onPress: () => void };
  /**
   * Called when it times out, is tapped away, or the screen unmounts it. The
   * screen owns `visible`, so nothing disappears without it being told.
   */
  onDismiss: () => void;
  /** `long` for anything with an `action` — a four-second undo is not one. */
  duration?: "short" | "long";
  testID?: string;
};

const GLYPHS: Record<StatusTone, IconName | null> = {
  neutral: null,
  info: "info",
  success: "check",
  warning: "warning",
  danger: "error",
};

export function Toast({
  visible,
  message,
  tone = "neutral",
  action,
  onDismiss,
  duration = "short",
  testID,
}: ToastProps) {
  const { colors, radius, space, shadow, motion } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  /* Outlives `visible` by the length of the exit, so the animation is not cut
     off at its first frame by an unmount. */
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduced ? motion.fast : motion.base,
      easing: ease.outExpo,
      useNativeDriver: true,
    });

    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });

    return () => animation.stop();
  }, [visible, mounted, progress, reduced, motion.base, motion.fast]);

  useEffect(() => {
    if (!visible) return;
    /*
     * Self-dismissing, but only when there is nothing to do. A toast carrying
     * an action is a toast the seller may be reaching for — taking it away
     * mid-reach is worse than leaving it until they answer.
     */
    if (action) return;
    const ms = duration === "long" ? 6000 : 3200;
    const timer = setTimeout(onDismiss, ms);
    return () => clearTimeout(timer);
  }, [visible, action, duration, onDismiss]);

  if (!mounted) return null;

  /*
   * The two skins, and the reason there are two rather than five.
   *
   * `neutral` and `info` take the inverted surface — a dark slab in light mode
   * and a light one in dark — because a toast reporting that something worked
   * should not compete with the screen it is over. `success`, `warning` and
   * `danger` take their own colour, because those three are reporting a
   * *state* and the colour is half the message.
   */
  const coloured = tone === "success" || tone === "warning" || tone === "danger";
  const bg = coloured
    ? { success: colors.success, warning: colors.warning, danger: colors.danger }[tone]
    : colors.surfaceInverse;
  const glyph = GLYPHS[tone];

  return (
    <View
      /* `box-none`, so the area either side of the toast passes taps through to
         whatever the screen has underneath it. */
      pointerEvents="box-none"
      style={{
        position: "absolute",
        insetInlineStart: 0,
        insetInlineEnd: 0,
        bottom: insets.bottom + space.md,
        paddingHorizontal: space.md,
      }}
      testID={testID}
    >
      <Animated.View
        style={{
          opacity: progress,
          transform: [
            {
              /* Rises from below rather than fading in place: a toast is a
                 thing that *arrives*, and where it arrives from is the edge it
                 sits against. Reduced motion keeps the fade and drops the
                 travel. */
              translateY: reduced
                ? 0
                : progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
            },
          ],
        }}
      >
        <Pressable
          /* The whole toast dismisses. A message with no visible close button
             that also cannot be tapped away is a message the seller has to
             wait out. */
          onPress={onDismiss}
          accessibilityRole="alert"
          /* `polite`, not `assertive`: a toast reports what already happened,
             and interrupting whatever the seller is reading to say "Saved" is
             worse than saying it a beat later. */
          accessibilityLiveRegion="polite"
          accessibilityLabel={message}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            backgroundColor: bg,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            minHeight: MIN_TAP,
            borderRadius: radius.xl,
            borderCurve: "continuous",
            ...(shadow.overlay ? { boxShadow: shadow.overlay } : null),
            /* Dark mode has no shadow to separate the slab from the page, so
               it gets an edge instead. */
            ...(shadow.overlay ? null : { borderWidth: 1, borderColor: colors.border }),
          }}
        >
          {glyph ? <Icon name={glyph} size="sm" tone="inverse" /> : null}
          <View style={{ flex: 1 }}>
            <Text variant="callout" tone="inverse">
              {message}
            </Text>
          </View>
          {action ? (
            <Pressable
              onPress={action.onPress}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              <Text variant="callout" weight="semibold" tone="inverse">
                {action.label}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}
