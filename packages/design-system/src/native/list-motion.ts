import {
  FadeIn,
  FadeInDown,
  LinearTransition,
  ReduceMotion,
} from "react-native-reanimated";
import { motion } from "./theme";

/**
 * The motion a list is allowed to have.
 *
 * WHY THIS IS A SEPARATE MODULE FROM `./motion`
 *
 * `motion.ts` holds seven hooks built on React Native's `Animated`, and its
 * header sets out the rule this file obeys: those hooks are native-driven,
 * tested, and rewriting them to gain nothing is churn — while a surface that
 * genuinely needs the UI thread reaches for Reanimated directly. Entering and
 * layout animations are exactly that. They are declarative, they run inside
 * Reanimated's own layout system, and there is no `Animated` equivalent: a row
 * that animates *into a position the layout engine just computed* cannot be
 * expressed with `Animated.timing`.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No exit animation on a row. A list row leaves because the seller changed a
 * filter or the server returned a shorter page, and an exit means the row that
 * replaces it waits for it — so a filter tap feels slower than it is. Rows
 * enter and are replaced; only the *sheet* animates out, because that one is a
 * thing the seller dismissed and watched go.
 *
 * No animation on a value changing inside a row either. A price that fades when
 * a refetch returns the same number is a list that flickers every thirty
 * seconds, and the refetch is not something the seller did.
 */

/**
 * How far apart two rows arrive.
 *
 * 40ms, and capped at the sixth row. A flat step looks considered for the first
 * handful and broken for the fortieth, where the last item lands two seconds
 * after the first and the seller is staring at a half-drawn screen. Past the cap
 * everything shares the final delay, so a long list still settles as one thing.
 *
 * The cap is also what keeps this honest on a recycling list: `FlashList` reuses
 * row views, so an index far down the list is a view that has already been
 * mounted and animated once. Capping the delay means the reuse is invisible
 * rather than arriving late.
 */
const STEP = 40;
const MAX_STEPS = 6;

export function stagger(index: number): number {
  return Math.min(index, MAX_STEPS) * STEP;
}

/**
 * A row arriving.
 *
 * Fade plus a short rise — the same entrance `Screen` gives its content, so a
 * list settling and a screen arriving are one gesture rather than two.
 *
 * `ReduceMotion.System` is the whole accessibility story in one call:
 * Reanimated drops the *translation* and keeps the fade when the phone asks for
 * less movement, which is the rule `motion.ts` states and the reason this is not
 * hand-rolled.
 */
export function rowEntering(index: number) {
  return FadeInDown.duration(motion.base)
    .delay(stagger(index))
    /* 12pt, matching `useEntrance`. The distance is what separates "this
       arrived" from "this flew in". */
    .springify()
    .damping(22)
    .stiffness(220)
    .reduceMotion(ReduceMotion.System);
}

/**
 * A block arriving that is not in a list — a banner, an empty state, a result
 * that replaces a spinner.
 *
 * Opacity only, and no delay. There is nothing above it to stagger against, and
 * a block that slides has to slide *from* somewhere — which for something that
 * replaces content in place is nowhere.
 */
export function blockEntering() {
  return FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System);
}

/**
 * Rows moving because the list changed under them.
 *
 * The case this is for: a status filter is tapped and eleven rows become four.
 * Without it the four replace the eleven between one frame and the next, which
 * reads as the screen having been reloaded rather than filtered — the seller
 * cannot tell whether the rows they were looking at were removed or whether
 * they are looking at a different screen.
 *
 * `LinearTransition` rather than a spring: rows are moving *to a computed
 * layout*, not responding to a finger, and a spring that overshoots a row
 * position makes the hairlines between rows visibly cross.
 */
export const rowLayout = LinearTransition.duration(motion.base).reduceMotion(
  ReduceMotion.System,
);
