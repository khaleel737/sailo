import { useUnistyles } from "react-native-unistyles";
import type { Tone } from "../types";

/**
 * A `Tone` as an actual colour string.
 *
 * Almost everything in this package should be reaching for a Unistyles variant
 * instead of this — a variant is a style the runtime recomputes when the theme
 * changes, and a string is a value that has to be re-read. This exists for the
 * two places a style object is not what is wanted:
 *
 *   - `Icon`, because `SymbolView` takes `tintColor` as a prop rather than
 *     through a stylesheet, and the Lucide fallback takes `color`;
 *   - `Chart`, because SVG paints with `stroke` and `fill` props.
 *
 * Both re-render on a theme change because `useUnistyles` subscribes them, so
 * the values stay live. If you are reaching for this from anything with a
 * `style`, use a variant.
 */
export function useToneColor(tone: Tone): string {
  const { theme } = useUnistyles();
  const { colors } = theme;

  switch (tone) {
    case "muted":
      return colors.contentMuted;
    case "brand":
      return colors.accent;
    case "danger":
      return colors.danger;
    case "success":
      return colors.success;
    case "warning":
      return colors.warning;
    case "inverse":
      return colors.contentInverse;
    default:
      return colors.content;
  }
}
