import { I18nManager, Text as RNText, type TextStyle } from "react-native";
import { type as typeScale, useTheme } from "./theme";
import type { Alignment, TextVariant, TextWeight, Tone } from "./types";
import { toneColor } from "./tone";

/**
 * Every string the app draws.
 *
 * There is no `style` prop and no `fontSize`. A screen says what a piece of
 * text *is* — a title, a caption — and the theme decides how that looks, which
 * is what lets Dynamic Type, dark mode and a later type-scale change happen in
 * one package instead of forty screens.
 */
export type TextProps = {
  children: React.ReactNode;
  /** @default "body" */
  variant?: TextVariant;
  /** @default "default" */
  tone?: Tone;
  /** Overrides the weight the variant would have used. Use sparingly. */
  weight?: TextWeight;
  /** @default "start" */
  align?: Alignment;
  /** Truncate with an ellipsis after this many lines. */
  numberOfLines?: number;
  /** Long-pressable to copy — order references, tracking numbers. */
  selectable?: boolean;
  /**
   * Monospaced digits, at whatever size the variant already chose.
   *
   * The `numeric` variant exists for a figure in a column and is body-sized, so
   * until this prop there was no way to set a *large* number in tabular figures
   * — and the chart's headline total is exactly that: a money figure at
   * `title` size whose digits change as the reader scrubs. In the proportional
   * default `1` is narrower than `8`, so the total visibly shivers, which reads
   * as the layout being unstable rather than as the number being live.
   *
   * Additive rather than a new variant, because size and figure-style are
   * genuinely separate decisions and folding them together is what produced the
   * gap: `numeric` had to pick one size and picked the one a table needs.
   */
  tabular?: boolean;
  /**
   * Announce this as a heading to a screen reader.
   *
   * Separate from `variant` because the two are different questions: a
   * `caption` can be the heading of a section and a `title` can be decorative.
   */
  heading?: boolean;
  testID?: string;
};

const WEIGHTS: Record<TextWeight, TextStyle["fontWeight"]> = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};

/**
 * How far Dynamic Type may take each step, and why the big ones are capped.
 *
 * Scaling is on everywhere — turning it off is not an option in a product
 * somebody runs a business from, and the accessibility sizes go up to 310%.
 * But the scale is *optical*, not linear: at 310% a 13pt caption is 40pt and
 * still reads as a caption, while a 44pt hero is 136pt and is three words per
 * screen. The large steps are already large because they are meant to be, so
 * they need less of the increase than the small ones do — capping them is what
 * keeps a title on two lines instead of six, and keeps the *relationship*
 * between a title and its body intact at the top of the range.
 *
 * `undefined` means uncapped, and body copy is deliberately uncapped: it is
 * the text somebody actually has to read, and it is the one this setting
 * exists for.
 */
const MAX_SCALE: Partial<Record<TextVariant, number>> = {
  hero: 1.4,
  display: 1.5,
  title: 1.6,
  numeric: 1.6,
};

export function Text({
  children,
  variant = "body",
  tone = "default",
  weight,
  align = "start",
  numberOfLines,
  selectable,
  tabular,
  heading,
  testID,
}: TextProps) {
  const { colors } = useTheme();
  const color = toneColor(colors, tone);

  return (
    <RNText
      style={[
        typeScale[variant] as TextStyle,
        { color, textAlign: textAlign(align) },
        /*
         * Tabular figures, on the one step that asks for them.
         *
         * `fontVariant` reaches the system face's OpenType features on both
         * platforms, which is the only reason the app can have monospaced
         * digits without shipping a second font — and shipping one is what it
         * would otherwise take, since a bundled Latin face would have nothing
         * to fall back to for the Arabic and CJK locales.
         */
        variant === "numeric" || tabular
          ? { fontVariant: ["tabular-nums"] as const }
          : null,
        weight ? { fontWeight: WEIGHTS[weight] } : null,
      ]}
      numberOfLines={numberOfLines}
      selectable={selectable}
      maxFontSizeMultiplier={MAX_SCALE[variant]}
      accessibilityRole={heading ? "header" : undefined}
      testID={testID}
    >
      {children}
    </RNText>
  );
}

/**
 * `start`/`end` as React Native spells it.
 *
 * The style prop only accepts `left`/`right`/`center`/`auto`, so the logical
 * names have to resolve here rather than in every caller. `auto` for `start`
 * because that is already "the direction this text reads", which is the whole
 * point — and `end` is the only one that has to ask `I18nManager`.
 */
function textAlign(align: Alignment): TextStyle["textAlign"] {
  if (align === "center") return "center";
  if (align === "start") return "auto";
  return I18nManager.isRTL ? "left" : "right";
}
