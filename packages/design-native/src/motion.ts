import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, type EasingFunction } from "react-native";
import { motion, PRESS_SCALE } from "./theme";

/**
 * Every animation in the product, and the one switch that turns them all off.
 *
 * WHY THESE HOOKS ARE STILL `Animated` NOW THAT REANIMATED IS HERE
 *
 * This file used to open by arguing that Reanimated was the better library and
 * that this app did not get to use it: it is a native module, and Expo's
 * autolinking builds its module list from `apps/mobile`'s own dependencies, so
 * the copy hoisted at the workspace root as an optional peer of `expo-router`
 * was resolvable by Metro and *absent from the binary*. A runtime crash on the
 * first animated screen, invisible to a typecheck, to the tests, and to Expo Go.
 *
 * **That hazard has not gone away — it has been paid off.** `react-native-
 * reanimated`, `react-native-worklets`, `react-native-gesture-handler` and
 * `@shopify/react-native-skia` are now declared in `apps/mobile/package.json`
 * itself, which is the only thing autolinking reads, and
 * `apps/mobile/babel.config.js` carries the worklets plugin the whole scheme
 * depends on. The chart is what bought it: `victory-native` draws on Skia and
 * scrubs with Gesture Handler, and none of that has an `Animated` equivalent.
 *
 * So the note is kept rather than deleted, because the reasoning is what stops
 * somebody re-introducing the bug. **The rule that survives it: a native module
 * this package depends on must also be declared by `apps/mobile`, even when no
 * screen imports it.** Metro will resolve it from the root and the binary will
 * not have it. `metro.config.js` tells the same story about `expo-network`.
 *
 * What did not change is these seven hooks. `Animated` runs on the UI thread
 * for exactly the properties they animate — `opacity` and `transform` are what
 * `useNativeDriver` supports, and they are two of the three things anything
 * here moves. The third is colour, which interpolates on the JS thread under
 * either library; that is why the colour hooks below are separate and say so.
 * Rewriting working, tested, native-driven animations to gain nothing is churn.
 *
 * **Where Reanimated belongs instead:** gestures, and anything that has to
 * follow a finger. A drag reading its position on the JS thread is a frame
 * behind by construction, and `Animated` has no answer to that. The chart's
 * scrub is the first such surface; new ones should reach for Reanimated
 * directly rather than extending these hooks to cover a case they cannot.
 *
 * THE RULE ABOUT REDUCED MOTION
 *
 * Every hook here reads `useReducedMotion()` and, when it is on, jumps to the
 * end state rather than shortening the duration. A faster animation is still an
 * animation, and the setting exists for people for whom motion causes actual
 * nausea. Opacity is the exception that stays: a cross-fade is not vestibular
 * motion, and removing it leaves content popping in, which is its own problem.
 * So reduced motion keeps fades and drops *movement*.
 *
 * It binds Reanimated code too. `useReducedMotion` is exported from the package
 * index for exactly this reason, and a worklet-driven animation that ignores it
 * is the same bug as a JS-driven one that does.
 */

/**
 * The three curves, as functions React Native's driver can call.
 *
 * Built from the same four control points `@sailo/tokens` holds and
 * `globals.css` prints as `cubic-bezier(...)`, so a sheet on the phone and a
 * sheet in the admin decelerate identically. Built once at module scope
 * because `Easing.bezier` allocates a sampling table.
 */
export const ease: Record<keyof typeof motion.curve, EasingFunction> = {
  outQuint: Easing.bezier(...motion.curve.outQuint),
  outExpo: Easing.bezier(...motion.curve.outExpo),
  spring: Easing.bezier(...motion.curve.spring),
};

/**
 * Whether the phone has asked for less movement.
 *
 * Read once and then subscribed to, because it can change while the app is
 * open — iOS puts it in Control Center and Android in Developer Options, and
 * somebody who turns it on mid-session did so for a reason.
 *
 * Defaults to `false` while the first read is in flight. The alternative,
 * defaulting to `true`, means every launch briefly renders the motionless
 * variant and then animates when the answer arrives — which is a flash of
 * movement shown *only* to the people who asked not to see any.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;

    /*
     * Wrapped, and not for tidiness. `isReduceMotionEnabled` rejects rather
     * than resolving `false` on a platform that cannot answer, and an
     * unhandled rejection here would take down whatever screen mounted first.
     */
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => {
        /* No answer is not the same as "yes". Keep the animations. */
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => setReduced(value),
    );

    return () => {
      alive = false;
      /* Older React Native returned void here; `?.` is what makes the same
         code work under the jest-expo mock and on device. */
      subscription?.remove?.();
    };
  }, []);

  return reduced;
}

/**
 * Content arriving.
 *
 * A fade plus a short rise, which is the entrance every screen in the app uses
 * and the reason a push reads as *arriving* rather than as a cut. `delay` is
 * what would stagger a run of them, if a screen ever wanted one; nothing does
 * today, and a helper for computing the offsets was written and then deleted
 * rather than shipped unused.
 *
 * The rise is 12pt and not more. The distance is what separates "this arrived"
 * from "this flew in", and anything past about 16 starts to draw attention to
 * the animation instead of to the thing being animated.
 */
export function useEntrance(options?: { delay?: number; distance?: number; disabled?: boolean }) {
  const { delay = 0, distance = 12, disabled = false } = options ?? {};
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(disabled ? 1 : 0)).current;

  useEffect(() => {
    if (disabled) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.base,
      delay,
      easing: ease.outQuint,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay, disabled]);

  return useMemo(
    () => ({
      opacity: progress,
      transform: [
        {
          /* Reduced motion keeps the fade and drops the travel. A cross-fade
             is not vestibular motion; a 12pt slide is. */
          translateY: reduced
            ? 0
            : progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
        },
      ],
    }),
    [progress, reduced, distance],
  );
}

/**
 * A control being pressed.
 *
 * Returns the scale to hand to a `transform`, and the two handlers that drive
 * it. A spring rather than a timing curve because a press is *interruptible*:
 * a finger lifted 30ms in should release from where the control actually is,
 * and a timing curve restarted from an arbitrary midpoint visibly jumps.
 *
 * `useNativeDriver` throughout, so a press that lands while the list is
 * mid-scroll still animates — the JS thread is the busy one during a scroll,
 * and a press that stutters exactly when the user is most likely to make one
 * is the worst possible time for it.
 */
export function usePressScale(enabled = true) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const active = enabled && !reduced;

  const to = useCallback(
    (value: number) => {
      if (!active) return;
      Animated.spring(scale, {
        toValue: value,
        ...motion.spring,
        useNativeDriver: true,
      }).start();
    },
    [scale, active],
  );

  const onPressIn = useCallback(() => to(PRESS_SCALE), [to]);
  const onPressOut = useCallback(() => to(1), [to]);

  return { scale, onPressIn, onPressOut, animating: active };
}

/**
 * A boolean, as something that can be interpolated.
 *
 * For the states that are not "mounted" or "pressed" — a field gaining focus,
 * an error appearing, a row selecting. Returns a value that walks 0→1 when
 * `active` turns on and back when it turns off.
 *
 * `native` is false by default and that default is the safe one: the common use
 * is interpolating a colour, and a native-driven value cannot drive
 * `borderColor` — the animation simply does not run, silently, with no warning
 * anywhere. Pass `true` only when the output feeds `opacity` or `transform`.
 */
export function useTransition(active: boolean, options?: { duration?: number; native?: boolean }) {
  const { duration = motion.fast, native = false } = options ?? {};
  const value = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(value, {
      toValue: active ? 1 : 0,
      duration,
      easing: ease.outQuint,
      useNativeDriver: native,
    });
    animation.start();
    return () => animation.stop();
  }, [value, active, duration, native]);

  return value;
}

/**
 * The sweep across a skeleton.
 *
 * A travelling highlight rather than a pulse in opacity. The difference is
 * that a pulse says "this is a grey box that is fading", and a sweep says
 * "this is loading" — it is the one motion in the interface that carries a
 * meaning rather than a transition, and it is worth spending a loop on.
 *
 * Stopped entirely under reduced motion: an infinite loop is the single worst
 * offender for anybody who asked for less of it, and a static block reads as
 * "not loaded yet" perfectly well.
 */
export function useShimmer(): { progress: Animated.Value; running: boolean } {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, reduced]);

  return { progress, running: !reduced };
}

/**
 * A number that animates when it changes — a progress ratio, a bar height.
 *
 * Distinct from `useTransition` in that the target is arbitrary rather than
 * 0 or 1, and in that the *first* value is not animated: a progress bar that
 * grows from zero on mount is showing progress that did not happen.
 */
export function useAnimatedNumber(target: number, options?: { duration?: number; native?: boolean }) {
  const { duration = motion.base, native = false } = options ?? {};
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(target)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced) {
      value.setValue(target);
      return;
    }
    const animation = Animated.timing(value, {
      toValue: target,
      duration,
      easing: ease.outQuint,
      useNativeDriver: native,
    });
    animation.start();
    return () => animation.stop();
  }, [value, target, duration, native, reduced]);

  return value;
}
