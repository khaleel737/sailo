import type { Palette } from "./theme";
import type { Tone } from "./types";

/**
 * A tone, resolved against the active palette.
 *
 * Its own module because eight components need the same six-way mapping, and
 * the alternative was eight copies of an object literal that would drift the
 * first time a tone was added — which is exactly what happened when `warning`
 * arrived and only some of them knew about it.
 */
export function toneColor(colors: Palette, tone: Tone): string {
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
