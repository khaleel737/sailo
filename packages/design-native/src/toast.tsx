import { useEffect } from "react";
import { Pressable } from "react-native";
import Animated, { FadeOutDown, ReduceMotion, SlideInDown } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { duration } from "@sailo/tokens";
import type { StatusTone } from "./types";
import { Text } from "./text";
import { components, slopTo } from "./theme/components";
import { curve } from "./theme/motion";

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
 * matters also belongs next to the control that caused it.
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
   * Called when it times out, is swiped away, or the screen unmounts it. The
   * screen owns `visible`, so nothing disappears without it being told.
   */
  onDismiss: () => void;
  /** `long` for anything with an `action` — a four-second undo is not one. */
  duration?: "short" | "long";
  testID?: string;
};

export function Toast({
  visible,
  message,
  tone = "neutral",
  action,
  onDismiss,
  duration: dwell = "short",
  testID,
}: ToastProps) {
  /*
   * The timer is the component's, the decision is the screen's: this calls
   * `onDismiss` and nothing else, so `visible` only ever changes where the
   * screen changes it. A toast that hid itself would leave the screen holding
   * a `true` for something that is no longer on screen.
   *
   * Restarting on `message` matters — a second "Saved" arriving four seconds
   * into the first one's life should get its own five seconds, not the one
   * second left over.
   */
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, components.toast.dwell[dwell]);
    return () => clearTimeout(timer);
  }, [visible, dwell, message, onDismiss]);

  styles.useVariants({ tone });

  if (!visible) return null;

  return (
    <Animated.View
      style={styles.toast}
      entering={SlideInDown.duration(duration.pop).easing(curve.spring).reduceMotion(ReduceMotion.System)}
      exiting={FadeOutDown.duration(duration.base).easing(curve.outQuint).reduceMotion(ReduceMotion.System)}
      /*
       * `polite`: a toast reports something that has already happened, so it
       * waits for the reader to finish the sentence they were on. The one that
       * interrupts is a field error, because that one is about what the seller
       * is doing right now.
       */
      accessibilityLiveRegion="polite"
      accessible
      testID={testID}
    >
      <Text variant="callout" numberOfLines={3}>
        {message}
      </Text>

      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={slopTo(24)}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text variant="callout" weight="semibold" tone="brand">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  /*
   * Elevated rather than tinted, with a hairline in the tone's colour on the
   * leading edge. A fully tinted toast has to solve its own text contrast in
   * five colours on two grounds; a neutral panel with a coloured edge reads as
   * the same tone and keeps the message at the full content contrast.
   */
  toast: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.lg,
    alignSelf: "stretch",
    paddingHorizontal: theme.components.toast.paddingInline,
    paddingVertical: theme.components.toast.paddingBlock,
    borderRadius: theme.components.toast.radius,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStartWidth: 4,

    shadowColor: "#000000",
    shadowOpacity: theme.components.card.elevation.shadowOpacity,
    shadowRadius: theme.components.card.elevation.shadowRadius,
    shadowOffset: theme.components.card.elevation.shadowOffset,
    elevation: theme.components.card.elevation.androidElevation,

    variants: {
      tone: {
        neutral: { borderStartColor: theme.colors.borderStrong },
        info: { borderStartColor: theme.colors.info },
        success: { borderStartColor: theme.colors.success },
        warning: { borderStartColor: theme.colors.warning },
        danger: { borderStartColor: theme.colors.danger },
      },
    },
  },
}));
