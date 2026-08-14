import { Text as RNText, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { StatusTone } from "./types";
import { typeStyle } from "./theme/typography";

/**
 * A small coloured badge saying what state something is in.
 *
 * `label` and `tone` are separate arguments because the mapping between them is
 * the caller's: an order status is translated by `@sailo/i18n` and coloured by
 * a table that lives with the order screens, and baking either into this
 * component would put a domain in a design system.
 *
 * The tone is never the only signal. A pill carries its own word, so a seller
 * who cannot tell the green from the amber still reads "Confirmed".
 */
export type StatusPillProps = {
  label: string;
  /** @default "neutral" */
  tone?: StatusTone;
  /** @default "md" */
  size?: "sm" | "md";
  testID?: string;
};

/**
 * The one component that does not route its text through `Text`, and the
 * reason is the reason this component exists.
 *
 * A pill's ink is a *pair* with its fill: `success` on the page is emerald-700
 * on paper, and `success` inside a green pill is emerald-800 on emerald-100.
 * Those are two different colours for one word, and `Text` takes a semantic
 * `Tone` that has no way to say "the ink that goes with this fill" — `info` is
 * not even in `Tone`, because a neutral blue only carries meaning in a badge.
 *
 * So the pair comes out of `colors.statusTone` together, and the type scale
 * still comes from `typeStyle` — the same sizes, the same font scale, the same
 * Dynamic Type behaviour as everything else. What is not shared is only the
 * colour, which is the part that genuinely differs.
 */
export function StatusPill({ label, tone = "neutral", size = "md", testID }: StatusPillProps) {
  styles.useVariants({ tone, size });

  return (
    <View style={styles.pill} testID={testID}>
      <RNText style={styles.label} numberOfLines={1}>
        {label}
      </RNText>
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  /*
   * `alignSelf: flex-start` so a pill hugs its word wherever it is dropped. A
   * badge that stretches to its container is a banner, and the rows that put
   * one after a value would get a full-width green bar.
   */
  pill: {
    alignSelf: "flex-start",
    borderRadius: theme.components.pill.radius,

    variants: {
      tone: {
        neutral: { backgroundColor: theme.colors.statusTone.neutral.background },
        info: { backgroundColor: theme.colors.statusTone.info.background },
        success: { backgroundColor: theme.colors.statusTone.success.background },
        warning: { backgroundColor: theme.colors.statusTone.warning.background },
        danger: { backgroundColor: theme.colors.statusTone.danger.background },
      },
      size: {
        sm: {
          paddingHorizontal: theme.components.pill.paddingInline.sm,
          paddingVertical: theme.components.pill.paddingBlock.sm,
        },
        md: {
          paddingHorizontal: theme.components.pill.paddingInline.md,
          paddingVertical: theme.components.pill.paddingBlock.md,
        },
      },
    },
  },
  label: {
    fontWeight: theme.fontWeights.semibold,

    variants: {
      tone: {
        neutral: { color: theme.colors.statusTone.neutral.content },
        info: { color: theme.colors.statusTone.info.content },
        success: { color: theme.colors.statusTone.success.content },
        warning: { color: theme.colors.statusTone.warning.content },
        danger: { color: theme.colors.statusTone.danger.content },
      },
      /*
       * `sm` borrows the caption-1 metrics and `md` the footnote — one step
       * apart, so a pill beside a body line and a pill beside a caption both
       * sit right. The uppercasing that comes with `label` is put back: that
       * treatment belongs to the section headers a reader is meant to skip
       * over, and a status is a word to actually read. "SHIPPED" also breaks
       * the moment the word is Arabic, where there is no such case to shout in.
       */
      size: {
        sm: { ...typeStyle("label", rt.fontScale), textTransform: "none" },
        md: typeStyle("caption", rt.fontScale),
      },
    },
  },
}));
