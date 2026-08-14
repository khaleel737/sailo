import { SymbolView } from "expo-symbols";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { IconName, Size, Tone } from "./types";
import { icons } from "./theme/icons";
import { useToneColor } from "./theme/tone-color";

/**
 * A glyph, named for what it means rather than for what it is called on this
 * platform.
 *
 * The mapping from `name` to an SF Symbol on iOS and a vector on Android lives
 * inside this package. A screen that wrote `sf="cart.fill"` would be a screen
 * that has to be edited again for Android, and edited a third time when Apple
 * renames a symbol.
 *
 * `accessibilityLabel` is optional and usually wrong to set. An icon beside a
 * label is decoration and should be silent; only an icon that *is* the control
 * — a bare close button — needs a name of its own.
 */
export type IconProps = {
  name: IconName;
  /** @default "md" */
  size?: Size;
  /** @default "default" */
  tone?: Tone;
  /** Set only when this icon carries meaning no nearby text repeats. */
  accessibilityLabel?: string;
  testID?: string;
};

export function Icon({
  name,
  size = "md",
  tone = "default",
  accessibilityLabel,
  testID,
}: IconProps) {
  const { theme, rt } = useUnistyles();
  const color = useToneColor(tone);
  const glyph = icons[name];

  /*
   * Only the two glyphs that point along the writing direction flip, and only
   * the fallback: an SF Symbol named `.forward` or `.backward` mirrors itself
   * when the interface direction does, so flipping it here as well would turn
   * it back round in Arabic.
   */
  const mirrored = Boolean(glyph.mirrors) && rt.rtl;
  styles.useVariants({ size, mirrored });

  /*
   * Icons scale with Dynamic Type, like the text they sit beside. A 20pt glyph
   * next to 34pt text reads as a mistake, and iOS scales SF Symbols for exactly
   * this reason. Nothing clamps it — see `theme/typography.ts`. This is a
   * number rather than a style because both `SymbolView` and Lucide take the
   * point size as a prop.
   */
  const points = Math.round(theme.components.icon.size[size] * rt.fontScale);

  const Fallback = glyph.lucide;

  return (
    <SymbolView
      name={glyph.sf}
      size={points}
      tintColor={color}
      resizeMode="scaleAspectFit"
      fallback={<Fallback size={points} color={color} style={styles.fallback} />}
      style={styles.box}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? "yes" : "no-hide-descendants"}
      testID={testID}
    />
  );
}

/*
 * The box is sized here rather than inline so that a font-scale change
 * recomputes it through the same path everything else in this package uses.
 * `SymbolView` reserves no intrinsic space on Android, so without an explicit
 * square the fallback and the symbol lay out differently on the two platforms.
 */
const styles = StyleSheet.create((theme, rt) => ({
  box: {
    variants: {
      size: {
        sm: square(theme.components.icon.size.sm, rt.fontScale),
        md: square(theme.components.icon.size.md, rt.fontScale),
        lg: square(theme.components.icon.size.lg, rt.fontScale),
      },
    },
  },
  fallback: {
    variants: {
      mirrored: {
        true: { transform: [{ scaleX: -1 }] },
        false: {},
      },
    },
  },
}));

function square(points: number, fontScale: number) {
  const side = Math.round(points * fontScale);
  return { width: side, height: side };
}
