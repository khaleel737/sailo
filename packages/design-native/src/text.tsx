import { Text as RNText } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { Alignment, TextVariant, TextWeight, Tone } from "./types";
import { typeScale, typeStyle } from "./theme/typography";

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
   * Announce this as a heading to a screen reader.
   *
   * Separate from `variant` because the two are different questions: a
   * `caption` can be the heading of a section and a `title` can be decorative.
   */
  heading?: boolean;
  testID?: string;
};

export function Text({
  children,
  variant = "body",
  tone = "default",
  weight,
  align = "start",
  numberOfLines,
  selectable,
  heading,
  testID,
}: TextProps) {
  /*
   * The variant carries a weight of its own — a title is bold — and `weight`
   * is an override rather than an addition. Resolving it here instead of
   * letting two variant groups both write `fontWeight` means there is no
   * question about which one wins.
   *
   * `tone="default"` goes in as `undefined` on purpose. Unistyles reserves the
   * key `default` in a variant group for the no-value case and will not accept
   * it as a value, so the group below names the ordinary colour `default` and
   * this selects it by asking for nothing — which is what "default" meant.
   */
  styles.useVariants({
    variant,
    tone: tone === "default" ? undefined : tone,
    align,
    weight: weight ?? typeScale[variant].weight,
  });

  return (
    <RNText
      style={styles.text}
      numberOfLines={numberOfLines}
      selectable={selectable}
      accessibilityRole={heading ? "header" : undefined}
      testID={testID}
    >
      {children}
    </RNText>
  );
}

/*
 * `allowFontScaling` is left at its default of true and never capped — see the
 * header of `theme/typography.ts` for why there is no `maxFontSizeMultiplier`
 * anywhere in this package.
 *
 * `lineHeight` is multiplied by `rt.fontScale` by hand because React Native
 * scales `fontSize` on its own and leaves leading alone; at the largest
 * accessibility size that difference is the one between a paragraph and a
 * stack of overlapping lines. Unistyles recomputes this sheet when the font
 * scale changes, so it tracks without anything re-rendering deliberately.
 */
const styles = StyleSheet.create((theme, rt) => ({
  text: {
    variants: {
      variant: {
        display: typeStyle("display", rt.fontScale),
        title: typeStyle("title", rt.fontScale),
        heading: typeStyle("heading", rt.fontScale),
        body: typeStyle("body", rt.fontScale),
        callout: typeStyle("callout", rt.fontScale),
        caption: typeStyle("caption", rt.fontScale),
        label: typeStyle("label", rt.fontScale),
      },
      tone: {
        default: { color: theme.colors.content },
        muted: { color: theme.colors.contentMuted },
        brand: { color: theme.colors.accent },
        danger: { color: theme.colors.danger },
        success: { color: theme.colors.success },
        warning: { color: theme.colors.warning },
        /*
         * The colour that reads on a strong fill — a primary button, a filled
         * banner. It is the same value the palette gives `accentContent` and
         * `dangerContent`, which is not a coincidence: "the ink that works on
         * a saturated ground" is one decision, and having it under one name
         * means a filled component never has to ask which fill it is on.
         */
        inverse: { color: theme.colors.contentInverse },
      },
      weight: {
        regular: { fontWeight: theme.fontWeights.regular },
        medium: { fontWeight: theme.fontWeights.medium },
        semibold: { fontWeight: theme.fontWeights.semibold },
        bold: { fontWeight: theme.fontWeights.bold },
      },
      /*
       * React Native's `textAlign` has no `start`, so the mapping happens here
       * rather than in the API — a screen still cannot spell `left`.
       *
       * `start` is `auto`, which is `NSTextAlignmentNatural` on iOS and
       * `Gravity.START` on Android: both follow the layout direction, so it is
       * the logical `start` under another name and needs no branch.
       *
       * `end` has no such keyword and does need one. `rt.rtl` rather than
       * `I18nManager.isRTL` because Unistyles lists `Rtl` as a dependency and
       * recomputes this sheet when it changes; the static read would leave the
       * alignment behind after a locale change.
       */
      align: {
        start: { textAlign: "auto" },
        center: { textAlign: "center" },
        end: { textAlign: rt.rtl ? "left" : "right" },
      },
    },
  },
}));
