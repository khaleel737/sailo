import { Text as RNText, View } from "react-native";
import type { StatusTone } from "./types.ts";

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

export function Toast({ visible, message, testID }: ToastProps) {
  if (!visible) return null;
  return (
    <View accessibilityLiveRegion="polite" testID={testID}>
      <RNText>{message}</RNText>
    </View>
  );
}
