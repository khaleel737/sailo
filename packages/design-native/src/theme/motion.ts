import { useCallback, useEffect } from "react";
import {
  cancelAnimation,
  Easing,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type WithTimingConfig,
} from "react-native-reanimated";
import { duration, easing } from "@sailo/tokens";
import { components } from "./components";

/**
 * Motion, as three configurations rather than as numbers typed into components.
 *
 * The easings are the product's three, shared with the web through
 * `@sailo/tokens` — a sheet on the phone decelerates on the same curve as a
 * sheet in the admin, because they are the same four control points and not two
 * people's idea of "smooth". Everything decelerates: nothing here should feel
 * like it is still accelerating when it arrives.
 *
 * ALL OF IT RUNS ON THE UI THREAD
 *
 * Every animation in this package is a Reanimated shared value read by a
 * worklet. Nothing animates through `setState`, and nothing goes near the
 * JS-thread `Animated` API — a press that has to round-trip through JavaScript
 * is a press that stutters exactly when the app is busiest, which is while a
 * list is loading.
 *
 * REDUCE MOTION
 *
 * `ReduceMotion.System` on every config, which is what makes an animation
 * respect the setting rather than merely have been told about it: Reanimated
 * drops the animation and jumps to its final value. Where the animation *is*
 * the component — the skeleton's sheen, which would otherwise loop forever —
 * `useReducedMotion()` switches it off at the source instead, because an
 * infinite animation that "arrives instantly" still arrives, forever.
 */

/**
 * The three curves, in the form Reanimated wants.
 *
 * Exported because the two components that animate on mount — `Sheet` and
 * `Toast` — use Reanimated's layout builders rather than `withTiming`, so they
 * cannot take one of the configs below and have to be handed the curve. Left
 * unexported they would silently fall back to Reanimated's default easing,
 * which is not this product's: a sheet would arrive on a different curve from
 * everything else in the app and from the same sheet on the web.
 */
export const curve = {
  outQuint: Easing.bezier(...easing.outQuint),
  outExpo: Easing.bezier(...easing.outExpo),
  spring: Easing.bezier(...easing.spring),
} as const;

/**
 * A press, a tint, a value ticking over. Short enough to read as a response to
 * the finger rather than as an animation.
 */
export const pressTiming: WithTimingConfig = {
  duration: duration.fast,
  easing: curve.outQuint,
  reduceMotion: ReduceMotion.System,
};

/** A fade or a cross-dissolve — anything appearing in place. */
export const fadeTiming: WithTimingConfig = {
  duration: duration.base,
  easing: curve.outQuint,
  reduceMotion: ReduceMotion.System,
};

/**
 * The press behaviour every control in this package shares.
 *
 * Returned as handlers rather than applied inside a wrapper component so that
 * `Button`, `Card` and `ListRow` can each keep their own `Pressable` and still
 * feel identical under the thumb. The scale is a shared value, so the whole
 * thing stays on the UI thread; `pressed` is React state only because the
 * *colour* change is a Unistyles variant, and variants are resolved at render.
 *
 * `scale` is optional because not everything that presses should move — a list
 * row shifts its background instead, since a row that shrinks drags the
 * separators either side of it with it.
 */
export function usePressMotion(scale: number | null = components.button.pressScale) {
  const progress = useSharedValue(0);

  const onPressIn = useCallback(() => {
    progress.value = withTiming(1, pressTiming);
  }, [progress]);

  const onPressOut = useCallback(() => {
    progress.value = withTiming(0, pressTiming);
  }, [progress]);

  const style = useAnimatedStyle(() => {
    if (scale === null) return {};
    return { transform: [{ scale: 1 - progress.value * (1 - scale) }] };
  });

  return { onPressIn, onPressOut, style };
}

/**
 * Whether the reader has asked for less movement.
 *
 * Re-exported rather than imported from Reanimated in nine files, so that the
 * one place this package asks the question is this one — and so a component
 * that forgets to ask is visible as a component that does not import from here.
 */
export const useReduceMotion = useReducedMotion;

/**
 * The slow pulse a `Skeleton` breathes with.
 *
 * The one animation in this package that `ReduceMotion.System` cannot handle on
 * its own. Everything else has an end state to jump to; a loop does not, so
 * "finish instantly" means "finish, and start again, forever". Reduce Motion is
 * therefore checked here and the loop is never started — the bar sits at its
 * base colour, which is exactly what a skeleton is supposed to look like.
 *
 * Linear, not decelerating. A shimmer that eases is a shimmer that appears to
 * stop and restart, and the point of it is to say "still working" without
 * asking to be watched.
 */
export function useShimmer(from: string, to: string) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;

    progress.value = withRepeat(
      withTiming(1, { duration: SHIMMER_MS, easing: Easing.linear }),
      -1,
      /* Reverse rather than snap back — a sawtooth reads as a flicker. */
      true,
    );

    return () => {
      cancelAnimation(progress);
      progress.value = 0;
    };
  }, [reduceMotion, progress]);

  return useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [from, to]),
  }));
}

/** One breath, in milliseconds. Slow enough not to compete with the content. */
const SHIMMER_MS = 1600;
