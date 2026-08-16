import { useContext } from "react";
import { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

/**
 * Where the keyboard is, right now, on the UI thread.
 *
 * WHAT THIS REPLACES AND WHY IT WAS WRONG
 *
 * `Screen` pinned its footer with a `KeyboardAvoidingView` set to
 * `behavior="padding"` and no `keyboardVerticalOffset`. That is wrong in two
 * separate ways, and both of them are visible:
 *
 *   1. **It measures from the top of the window.** Every screen in this app
 *      sits inside a native stack, so its content starts below a navigation
 *      bar — 44pt, or 96pt under a large title. `KeyboardAvoidingView` does not
 *      know that, so it lifts the footer by the keyboard's full height *plus*
 *      the header it never accounted for. The symptom is a submit button that
 *      jumps too far and leaves a band of dead page under the form.
 *   2. **It is late.** It reacts to `keyboardWillShow`, then runs its own
 *      animation to catch up with an animation the system is already running.
 *      On a fast keyboard the two are close enough; on a slow one, on a device
 *      under load, or when the keyboard changes height because a suggestion bar
 *      appeared, the footer visibly lags behind the thing it is supposed to be
 *      sitting on.
 *
 * `useAnimatedKeyboard` reports the keyboard's *live height*, every frame of
 * the system's own show and hide, on the UI thread. A footer translated by it
 * is not following the keyboard — it is attached to it. There is no duration to
 * pick and no curve to match, because it is the same curve by construction.
 *
 * This is the one thing `Animated` has no answer to, which is why it is a new
 * module rather than a hook added to `./motion`. `motion.ts` explains the rule:
 * the seven hooks in there are native-driven and work, and rewriting them to
 * gain nothing is churn. A surface that genuinely needs the UI thread — a
 * gesture, or this — reaches for Reanimated directly.
 */

/**
 * How far something pinned to the bottom edge has to rise.
 *
 * The subtraction is the part worth reading. `useAnimatedKeyboard` reports the
 * keyboard's height from the *bottom of the screen*, and a pinned footer is
 * already sitting above the home indicator — so lifting it by the raw height
 * moves it too far by exactly the bottom safe-area inset, and leaves a strip of
 * page visible between the footer and the keyboard. `Math.max(0, …)` is what
 * keeps a closed keyboard from pushing the footer *down* into the indicator on
 * a device where the inset is larger than nothing.
 *
 * Returns a style rather than a number, because the caller must not be able to
 * put this on the JS thread by reading `.value` during render.
 */
export function useKeyboardLift() {
  const keyboard = useAnimatedKeyboard();
  /*
   * The context rather than `useSafeAreaInsets()`, which *throws* when no
   * provider is mounted above it.
   *
   * That is not a hypothetical: it is every unit test that renders a `Screen`
   * on its own, and it is any screen presented outside the navigator — a
   * dev-menu overlay, a crash fallback. A component whose failure mode is
   * "the whole subtree throws" because it wanted to know about a home
   * indicator is a component that has traded robustness for four points of
   * padding. `null` degrades to zero, which is exactly right on a device that
   * has no inset to begin with.
   */
  const bottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0;

  return useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.value - bottom) }],
  }));
}
