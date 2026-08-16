import { useMemo } from "react";
import { PixelRatio, Platform } from "react-native";
import { matchFont, type SkFont } from "@shopify/react-native-skia";

/**
 * The face the axis labels are drawn in.
 *
 * WHY THIS IS NOT JUST A `useFont(require("…ttf"))`
 *
 * Every other piece of text in the app is a React Native `<Text>`, which gets
 * the system face for free — and `theme.ts` explains at length why the system
 * face is the one worth having: it is the only one that supports Dynamic Type,
 * every script the 35 locales need, and Arabic, which a bundled Latin font
 * would silently fall back from mid-word.
 *
 * Skia draws outside all of that. It has no access to the text stack, so a
 * canvas label needs a typeface handed to it explicitly, and the usual answer
 * in Skia examples — bundling a `.ttf` and loading it with `useFont` — would
 * put a second face in the product and reintroduce every problem the system
 * face solves. `matchFont` asks the platform's own font manager instead, so the
 * axis is set in San Francisco on iOS and Roboto on Android, matching the
 * `<Text>` two pixels below it.
 *
 * WHY THE SIZE IS COMPUTED RATHER THAN CONSTANT
 *
 * `matchFont` returns a fixed-size face. Dynamic Type does not reach it: a
 * seller who has turned text up to accessibility sizes gets a card whose title,
 * total and readout all grow and whose axis stays at 11pt — which is worse than
 * a uniformly small chart, because the axis is then the only thing on the card
 * they cannot read. `getFontScale()` is what `<Text>` is scaling by, so
 * multiplying by it keeps the axis in proportion with everything around it.
 *
 * The scale is *capped*. At the largest accessibility sizes the multiplier goes
 * past 3, and a 33pt date under a 132pt plot is not an axis, it is a second
 * headline that overlaps its neighbours. Past the cap the labels stop growing
 * and `plot.tsx` thins them out instead — fewer, readable dates rather than
 * more, illegible ones.
 */

/** The axis label size at the system's default text size. */
const AXIS_SIZE = 11;

/**
 * How far the axis is allowed to follow Dynamic Type.
 *
 * 1.6 is roughly the step where a date label stops fitting between two ticks at
 * phone width. Beyond it the reader is better served by `plot.tsx` dropping
 * ticks than by this growing.
 */
const MAX_FONT_SCALE = 1.6;

/**
 * The system face at the axis size, scaled for Dynamic Type.
 *
 * Memoised on the scale rather than rebuilt each render: `matchFont` allocates
 * a typeface, and the plot re-renders on every frame of a scrub.
 */
export function useAxisFont(): SkFont {
  const scale = Math.min(PixelRatio.getFontScale(), MAX_FONT_SCALE);

  return useMemo(
    () =>
      matchFont({
        /*
         * The platform's own default, spelled the way each platform's font
         * manager expects. "System" resolves to San Francisco on iOS; Android's
         * manager does not know that name and answers with its fallback, which
         * is Roboto — the right face, reached by the right name.
         */
        fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
        fontSize: AXIS_SIZE * scale,
        /*
         * Not the body weight. An axis is a reference the eye skips over on the
         * way to the marks, and at 11pt the regular weight of the system face
         * goes muddy against a grid line; 500 holds its shape without competing
         * with the figures in the readout.
         */
        fontWeight: "500",
      }),
    [scale],
  );
}
