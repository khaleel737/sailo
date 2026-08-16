import { Animated, View } from "react-native";
import { Button } from "./button";
import { Icon } from "./icon";
import { Text } from "./text";
import { useEntrance } from "./motion";
import { useTheme } from "./theme";
import type { IconName, StatusTone, Tone } from "./types";

/**
 * Something the seller has to read before the screen makes sense.
 *
 * Distinct from `Toast`, and the distinction is the point: a toast is
 * *transient* and belongs to an action that just happened, while a banner is
 * *standing* and belongs to the state the screen is in — "your payouts are
 * paused", "this shop is not published yet", "we could not reach the card
 * reader". A toast that has to be read is a toast that will be missed.
 *
 * WHY THE REFUSAL COPY ON THE AUTH SCREENS BECOMES ONE OF THESE
 *
 * `sign-in.tsx` rendered its three failure cases as a bare `<Text tone="danger">`
 * dropped into the form's `gap`. That is a red sentence with no edge, no icon
 * and no announcement, sitting in a stack of unrelated blocks — and on the one
 * screen where a seller is already unsure whether they did something wrong.
 * The tone carries the meaning for people who can see the colour and for nobody
 * else.
 */
export type BannerProps = {
  /** The sentence. One, and in the seller's terms. */
  message: string;
  /** A heading above it, for the cases where one sentence is not enough. */
  title?: string;
  /** @default "info" */
  tone?: StatusTone;
  /**
   * Overrides the glyph the tone would have chosen. Rarely right — the whole
   * point of the default is that a warning always looks like a warning.
   */
  icon?: IconName;
  /** The one thing the seller can do about it. */
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Announce this the moment it appears, interrupting whatever is being read.
   *
   * On by default for `danger`, because a refusal that appears silently under
   * a form leaves a screen-reader user pressing a button that keeps not
   * working. Off for the rest: a standing informational banner that interrupts
   * every time the screen re-renders is worse than one nobody hears.
   */
  live?: boolean;
  testID?: string;
};

/** Tone → the glyph and the two colours. The whole mapping, in one table. */
const GLYPHS: Record<StatusTone, IconName> = {
  neutral: "info",
  info: "info",
  success: "check",
  warning: "warning",
  danger: "error",
};

const TONES: Record<StatusTone, Tone> = {
  neutral: "muted",
  info: "default",
  success: "success",
  warning: "warning",
  danger: "danger",
};

export function Banner({
  message,
  title,
  tone = "info",
  icon,
  actionLabel,
  onAction,
  live,
  testID,
}: BannerProps) {
  const { colors, radius, space } = useTheme();
  const entrance = useEntrance({ distance: 6 });

  const skin = {
    neutral: { bg: colors.surfaceSunken, border: colors.border },
    info: { bg: colors.infoSurface, border: colors.infoBorder },
    success: { bg: colors.successSurface, border: colors.successBorder },
    warning: { bg: colors.warningSurface, border: colors.warningBorder },
    danger: { bg: colors.dangerSurface, border: colors.dangerBorder },
  }[tone];

  const announce = live ?? tone === "danger";

  return (
    <Animated.View
      style={[
        {
          flexDirection: "row",
          alignItems: "flex-start",
          gap: space.md,
          padding: space.md,
          borderRadius: radius.xl,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: skin.border,
          backgroundColor: skin.bg,
        },
        entrance,
      ]}
      /*
       * One accessible element, not three.
       *
       * The icon, the title and the message are one thought; leaving them as
       * separate nodes makes a screen-reader user swipe three times to learn
       * one fact, and the icon on its own is announced as an unlabelled image.
       * The action stays outside the group so it is still reachable as a
       * button.
       */
      accessible
      accessibilityRole={announce ? "alert" : "text"}
      /* Both, because neither platform honours the other's: `alert` is what
         iOS acts on, `accessibilityLiveRegion` is Android's half. */
      accessibilityLiveRegion={announce ? "assertive" : "none"}
      testID={testID}
    >
      <View style={{ paddingTop: 2 }}>
        <Icon name={icon ?? GLYPHS[tone]} size="sm" tone={TONES[tone]} />
      </View>

      <View style={{ flex: 1, gap: space.xs }}>
        {title ? (
          <Text variant="callout" weight="semibold" tone={TONES[tone]}>
            {title}
          </Text>
        ) : null}
        <Text variant="callout" tone={title ? "default" : TONES[tone]}>
          {message}
        </Text>
        {actionLabel && onAction ? (
          <View style={{ marginTop: space.xs, alignSelf: "flex-start" }}>
            <Button label={actionLabel} variant="ghost" size="sm" onPress={onAction} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}
