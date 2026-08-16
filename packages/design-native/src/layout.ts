import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { space } from "@sailo/tokens";

/**
 * How much room there is, and what to do with it.
 *
 * WHAT THIS FIXES
 *
 * Nothing in the app had a breakpoint. Every screen was laid out for one
 * width — roughly a 390pt iPhone — and rendered at that layout everywhere
 * else. Three consequences, all visible:
 *
 *   - **A 320pt iPhone SE** ran a row of three `Stat` tiles at 16pt margins
 *     and a 12pt gutter, leaving 89pt per tile. A four-figure revenue number in
 *     a currency with a three-letter code does not fit in 89 points, so it
 *     truncated — on the one number the screen exists to show.
 *   - **A 430pt Pro Max** got the same 16pt margins, so the content column grew
 *     with the device and the type did not. Long lines of body copy at 430pt
 *     are past the ~70-character measure where prose stops being scannable.
 *   - **An iPad** — `supportsTablet` is false today, so this is the landscape
 *     phone case and the Stage Manager case — got a phone layout stretched to
 *     1024pt, which is a form field a metre wide.
 *
 * WHAT IT IS NOT
 *
 * Not a media-query system, and deliberately no `sm`/`md`/`lg`. Those name
 * *sizes*, and a component that branches on a size is a component that has to
 * be re-tuned every time a device ships. Everything below names a *decision*:
 * how many columns a grid gets, how wide the readable column is, whether a
 * detail can sit beside a list. A screen asks the question it actually has.
 */

/**
 * The one number this is all derived from.
 *
 * Apple's own compact/regular split lands at 768pt for width, and that is the
 * threshold used here: below it there is one column of content and a phone's
 * worth of chrome, at or above it there is room for a second.
 *
 * There is deliberately no third tier. A layout with three behaviours has three
 * layouts to keep working, and this app has no screen whose content justifies
 * one — the iPad case is "wider gutters and a capped measure", not "a different
 * information architecture".
 */
const REGULAR_WIDTH = 768;

/**
 * The widest a column of running text may get before it stops being readable.
 *
 * ~70 characters at the body size, which is the measure typography has agreed
 * on for a century and which React Native gives no help with. Past it the eye
 * loses the line it was on during the return sweep, and the symptom is a reader
 * who re-reads lines without noticing they are doing it.
 */
const MAX_MEASURE = 620;

export type Layout = {
  /** The window's width, in points. */
  width: number;
  /** The window's height. Landscape detection, and little else. */
  height: number;
  /** True below 768pt — one column, phone chrome. The common case. */
  compact: boolean;
  /** True at 768pt and above. A second column is affordable. */
  regular: boolean;
  /**
   * Wider than it is tall. Distinct from `regular`: a phone in landscape is
   * *wide and very short*, which is a different problem — there is room for
   * columns and no room for vertical rhythm.
   */
  landscape: boolean;
  /**
   * The page's own side margin.
   *
   * Grows with the device rather than staying at 16: the margin is what
   * separates content from the bezel, and the amount of separation a 430pt
   * screen wants is not the amount a 320pt one can afford.
   */
  gutter: number;
  /**
   * How many tiles fit in a row of statistics.
   *
   * Three is the design; two is what a narrow phone actually has room for. The
   * threshold is derived rather than guessed — see `statColumns`.
   */
  statColumns: number;
  /**
   * The widest the content column may be, or `undefined` when the window is
   * already narrower than that.
   *
   * `undefined` rather than `width` so a caller can spread it into a style and
   * get nothing on a phone, instead of pinning a max-width that is always hit.
   */
  maxWidth: number | undefined;
};

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const compact = width < REGULAR_WIDTH;
    const landscape = width > height;

    /*
     * Three tiles need ~104pt each to hold a formatted amount without
     * truncating — measured against `AED 12,345`, which is the widest thing
     * the dashboard actually renders. Below that the row drops to two and the
     * third wraps, which is the one outcome that keeps every number legible.
     */
    const gutter = width < 360 ? space.md : width < REGULAR_WIDTH ? space.lg : space.xl;
    const available = width - gutter * 2;
    const statColumns = available / 3 >= 104 ? 3 : 2;

    return {
      width,
      height,
      compact,
      regular: !compact,
      landscape,
      gutter,
      statColumns,
      maxWidth: width > MAX_MEASURE ? MAX_MEASURE : undefined,
    };
  }, [width, height]);
}
