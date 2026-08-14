import { Text as RNText, View } from "react-native";
import { useTheme } from "./theme";
import type { StatusTone } from "./types";

/**
 * A word about the state something is in.
 *
 * The word is always drawn. Tone is decoration and never the carrier — a seller
 * who cannot separate the amber pill from the green one still reads "Pending"
 * and "Confirmed", and the same is true of anybody reading a black-and-white
 * screenshot in a support thread.
 */
export type StatusPillProps = {
  label: string;
  /** @default "neutral" */
  tone?: StatusTone;
  /** @default "md" */
  size?: "sm" | "md";
  /**
   * What a screen reader says instead of the bare word.
   *
   * The case this exists for is two pills side by side. The order detail screen
   * draws a status and a payment state next to each other, and VoiceOver reads
   * them as two unattached adjectives — "Confirmed, Paid" — with nothing saying
   * which belongs to the order and which to the money. The caller supplies the
   * missing half: "Order status: Confirmed".
   */
  accessibilityLabel?: string;
  testID?: string;
};

export function StatusPill({
  label,
  tone = "neutral",
  size = "md",
  accessibilityLabel,
  testID,
}: StatusPillProps) {
  const { colors, space, type } = useTheme();

  const skin = {
    neutral: { bg: colors.surfaceSunken, fg: colors.contentMuted, dot: colors.contentFaint },
    info: { bg: colors.infoSurface, fg: colors.info, dot: colors.info },
    success: { bg: colors.successSurface, fg: colors.success, dot: colors.success },
    warning: { bg: colors.warningSurface, fg: colors.warning, dot: colors.warning },
    danger: { bg: colors.dangerSurface, fg: colors.danger, dot: colors.danger },
  }[tone];

  const step = size === "sm" ? type.caption : type.callout;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: size === "sm" ? 4 : 6,
        backgroundColor: skin.bg,
        paddingHorizontal: size === "sm" ? space.sm : space.md,
        paddingVertical: size === "sm" ? 2 : 4,
        // A capsule, so no `borderCurve` — that is for rounded rectangles, and
        // on a full-radius shape it does nothing.
        borderRadius: 999,
        alignSelf: "flex-start",
      }}
      /* One stop. Without `accessible` the label below is set on a container a
         screen reader never lands on, which is the same as not setting it. */
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {/*
        A dot, on every tone including `neutral`.

        The alternative is a pill whose text sits at a different offset from its
        neighbours' depending on whether its tone earned an ornament — which on
        a list of orders is a column that does not line up. `neutral` draws its
        dot in the faint ink rather than the muted one, so it still reads as
        "no signal" without leaving a hole.
      */}
      <View
        style={{
          width: size === "sm" ? 5 : 6,
          height: size === "sm" ? 5 : 6,
          borderRadius: 999,
          backgroundColor: skin.dot,
        }}
      />
      {/*
        Drawn with `RNText` rather than the package's own `Text`, and this is
        the one component where that is right.

        `Text` takes a `Tone`, and `StatusTone` is deliberately a different
        union — `types.ts` explains why: a badge has an `info` blue that no
        piece of running text has, and running text has an `inverse` no badge
        has. Mapping one onto the other to reuse the component would make the
        two unions agree, which is precisely what they must not do. So the size
        and the tracking still come from the ramp; only the colour is applied
        here, and it comes from the palette six lines up.
      */}
      <RNText
        style={{
          fontSize: step.fontSize,
          lineHeight: step.lineHeight,
          letterSpacing: step.letterSpacing,
          fontWeight: "600",
          color: skin.fg,
        }}
        /* A long localised status — German's compounds are the usual culprit —
           truncates rather than wrapping the capsule into a two-line lozenge. */
        numberOfLines={1}
        /* The pill is a fixed-height capsule beside other fixed-height things
           in a row; letting it grow to 310% breaks the row rather than helping
           anybody, and the label is repeated in the accessible name above. */
        maxFontSizeMultiplier={1.4}
      >
        {label}
      </RNText>
    </View>
  );
}
