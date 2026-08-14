import type { TextVariant, TextWeight } from "../types";

/**
 * The type scale, sat on top of iOS's own.
 *
 * Every variant below is one of Apple's text styles at its default size, which
 * is not decoration: a seller who has turned text up to the largest
 * accessibility size expects *this* app to grow too, and the way to get that
 * for free is to start from the sizes the system is already scaling. `body` is
 * 17pt because iOS Body is 17pt, and a 16pt "body" would be a design system
 * quietly opting out of Dynamic Type.
 *
 * WHY THERE IS NO CAP
 *
 * React Native offers `maxFontSizeMultiplier`, and using it is the usual way an
 * app stops accessibility sizes breaking its layout. It is also a silent cap:
 * the seller asks for larger text, the app declines, and nothing says so. So
 * nothing here caps, and the layouts pay for it instead — `minHeight` and never
 * `height`, rows that wrap rather than truncate, and icons sized off the text
 * they sit beside. That constraint is why `listRow` has no fixed height.
 *
 * WHY `lineHeight` IS A RATIO AND NOT A NUMBER
 *
 * React Native scales `fontSize` by the system font scale on its own, and does
 * not scale `lineHeight`. Left as a constant, a caption at the largest size
 * gets 13pt of leading around 30pt of text and the lines overlap. So leading is
 * stored as a multiple here and multiplied by `miniRuntime.fontScale` where the
 * style is built — Unistyles recomputes on `FontScale`, so it tracks.
 */
export type TypeStyle = {
  /** The iOS text style this tracks. Recorded so the mapping is checkable. */
  readonly iosTextStyle: string;
  /** Points at the default ("Large") Dynamic Type setting. */
  readonly size: number;
  /** Leading as a multiple of `size`. See the header. */
  readonly leading: number;
  /** The weight this variant carries unless a caller overrides it. */
  readonly weight: TextWeight;
  /** Tracking, in points. Negative tightens the big sizes; positive opens `label`. */
  readonly tracking: number;
  /** `label` is the only variant that shouts. */
  readonly uppercase: boolean;
};

/** The four names, in the numbers React Native wants. */
export const fontWeights = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const satisfies Record<TextWeight, string>;

export const typeScale = {
  /** iOS Large Title. The one big number or name a screen opens with. */
  display: {
    iosTextStyle: "largeTitle",
    size: 34,
    leading: 1.21,
    weight: "bold",
    tracking: -0.4,
    uppercase: false,
  },
  /** iOS Title 1. A screen's own title, where the navigation bar isn't carrying it. */
  title: {
    iosTextStyle: "title1",
    size: 28,
    leading: 1.21,
    weight: "bold",
    tracking: -0.3,
    uppercase: false,
  },
  /** iOS Title 3. A section heading inside a screen. */
  heading: {
    iosTextStyle: "title3",
    size: 20,
    leading: 1.25,
    weight: "semibold",
    tracking: -0.2,
    uppercase: false,
  },
  /** iOS Body. Ordinary running text, and the default. */
  body: {
    iosTextStyle: "body",
    size: 17,
    leading: 1.29,
    weight: "regular",
    tracking: 0,
    uppercase: false,
  },
  /** iOS Callout. Body, one step down — supporting lines under a title. */
  callout: {
    iosTextStyle: "callout",
    size: 16,
    leading: 1.31,
    weight: "regular",
    tracking: 0,
    uppercase: false,
  },
  /** iOS Footnote. Hints, timestamps, the small print. */
  caption: {
    iosTextStyle: "footnote",
    size: 13,
    leading: 1.38,
    weight: "regular",
    tracking: 0,
    uppercase: false,
  },
  /**
   * iOS Caption 1, shouted.
   *
   * The all-caps group label above a list section. Tracking is opened because
   * capitals set at their normal tracking read as a solid block, and this is
   * the one variant the eye is meant to skip over rather than read.
   */
  label: {
    iosTextStyle: "caption1",
    size: 12,
    leading: 1.34,
    weight: "semibold",
    tracking: 0.6,
    uppercase: true,
  },
} as const satisfies Record<TextVariant, TypeStyle>;

/**
 * One variant as the four style properties React Native wants.
 *
 * Shared rather than living inside `Text`, because `Text` is not quite the only
 * caller: `StatusPill` draws a word in a colour that has no name in `Tone` — a
 * pill's ink is a *pair* with its fill, and `success` inside a green pill is a
 * different colour from `success` on the page. It still has to be the same
 * 12pt-at-this-font-scale that everything else is, and the way to guarantee
 * that is for the sizes to come from here rather than from a second opinion.
 *
 * The weight is deliberately absent. `Text` resolves it against an override and
 * a pill has one of its own, so leaving it out is what stops two callers both
 * writing `fontWeight` and disagreeing about which wins.
 */
export function typeStyle(variant: TextVariant, fontScale: number) {
  const style = typeScale[variant];
  return {
    fontSize: style.size,
    lineHeight: Math.round(style.size * style.leading * fontScale),
    letterSpacing: style.tracking,
    textTransform: style.uppercase ? ("uppercase" as const) : ("none" as const),
  };
}
