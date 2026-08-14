import { useMemo } from "react";
import { Platform, useColorScheme } from "react-native";
import { brand, easing, ink, radius, space } from "@sailo/tokens";

/**
 * The one place a colour is decided on the phone.
 *
 * Built from Sailo's own ramps rather than from the platform's semantic
 * colours, and that is a deliberate trade against the usual advice. iOS's
 * `label` / `secondaryLabel` / `separator` adapt for free and always look
 * native — but they are a *neutral* grey, and Sailo's neutral is warm. The web
 * app's `globals.css` explains why that matters: there used to be two greys,
 * a violet-tinted one and a warm one, and walking from the marketing page into
 * the admin read as walking into a different product. Taking the system grey
 * here would reintroduce exactly that seam, this time between the phone and
 * every other surface.
 *
 * So: one ramp, two modes, resolved through `useTheme()`. Everything a screen
 * can see is semantic — `content`, `surface`, `border` — never a step number,
 * so the ramp can be retuned without touching a component.
 *
 * `useColorScheme()` rather than a stored preference: the phone already has an
 * answer to "light or dark" and a second one in Settings is a setting nobody
 * asked for. It re-renders on the system flip, which is what makes the swap
 * instant with no theme provider in the tree.
 */

/** Light is the base. Dark is not an inversion — see the note below it. */
const light = {
  /** The page behind everything. */
  background: ink[50],
  /** A raised surface: cards, grouped rows, sheets. */
  surface: "#ffffff",
  /** A surface one step down — a field, a segmented track, a skeleton. */
  surfaceSunken: ink[100],
  /**
   * A surface one step *up* — a sheet over a card, a popover, a toast.
   *
   * In light mode this is the same white as `surface` and the separation is
   * carried by the shadow, which is what a raised thing looks like under a
   * light. Dark mode cannot do that (see `shadow` below) and lifts the fill
   * instead, which is why the two modes disagree about this one value.
   */
  surfaceElevated: "#ffffff",
  /** The inverted block the shop link sits in. */
  surfaceInverse: ink[950],

  /** Primary reading text. */
  content: ink[900],
  /** Supporting text: hints, captions, timestamps. */
  contentMuted: ink[500],
  /** Text that has said all it is going to say — a completed step. */
  contentFaint: ink[400],
  /** Text on `surfaceInverse` and on `accent`. */
  contentInverse: "#ffffff",

  border: ink[200],
  /** A hairline inside a grouped list, lighter than the group's own edge. */
  borderSubtle: ink[100],
  /** The edge of a control that has the keyboard. */
  borderStrong: ink[300],

  accent: brand[700],
  accentPressed: brand[800],
  accentSurface: brand[50],
  accentContent: brand[800],
  /** The accent as an *edge* — a tinted card's border, a focused field. */
  accentBorder: brand[200],

  danger: "#b42318",
  /**
   * The destructive button, held down.
   *
   * It exists because `Button`'s `danger` variant pressed *from* `danger` *to*
   * `danger` — the one control in the product that deletes things was the one
   * with no press feedback at all. Every other variant presses to a darker step
   * of a ramp it already has; the red does not have a ramp, so it gets this.
   */
  dangerPressed: "#912018",
  dangerSurface: "#fef3f2",
  dangerBorder: "#fecdca",
  warning: "#b54708",
  warningSurface: "#fffaeb",
  warningBorder: "#fedf89",
  success: brand[600],
  successSurface: brand[50],
  successBorder: brand[200],
  /** The one place a neutral blue means something: an informational badge. */
  info: "#175cd3",
  infoSurface: "#eff8ff",
  infoBorder: "#b2ddff",

  /**
   * The dim behind a sheet or a modal.
   *
   * Warm-black at 40% rather than pure black, for the same reason the neutral
   * ramp is warm: a cold scrim over a warm page tints everything under it blue
   * at the edges where the two meet.
   */
  scrim: "rgba(26, 25, 23, 0.40)",
  /** The base a skeleton is drawn in, and the highlight that sweeps across it. */
  skeleton: ink[100],
  skeletonSheen: "#ffffff",
  /**
   * The two stops of the one gradient the brand surfaces use.
   *
   * Drawn with `react-native-svg`'s `LinearGradient` rather than a native
   * gradient module — the package is already a peer, so this costs no new
   * dependency and no dev-client rebuild.
   */
  brandGradientFrom: brand[600],
  brandGradientTo: brand[800],
} as const;

/**
 * Dark, tuned rather than flipped.
 *
 * Three things do not survive a naive inversion. The accent is one: `brand-700`
 * is a deep green that reads as black-ish on a dark ground, so dark mode lifts
 * to `brand-400` — the same hue, enough luminance to be a colour again. The
 * second is the surface stack: `background` is *darker* than `surface`, because
 * on a dark ground a raised thing is lighter, which is the opposite of the
 * light stack and the reason this is not a mirrored table. The third is the
 * tinted surfaces — `dangerSurface` and friends are near-white in light mode
 * and cannot simply be darkened, because a dark red at 5% saturation is
 * indistinguishable from the page; they are re-picked at a luminance that still
 * separates from `surface`.
 */
const dark: Palette = {
  background: ink[950],
  surface: "#171613",
  surfaceSunken: "#201f1b",
  /* Lifted rather than shadowed — see `shadow` below. */
  surfaceElevated: "#232119",
  surfaceInverse: ink[100],

  content: ink[100],
  contentMuted: ink[400],
  contentFaint: ink[500],
  contentInverse: ink[950],

  border: "#33312c",
  borderSubtle: "#26241f",
  borderStrong: "#48453e",

  accent: brand[400],
  accentPressed: brand[300],
  accentSurface: "#06301c",
  accentContent: brand[300],
  accentBorder: "#0a5233",

  danger: "#f97066",
  /* Dark mode's red is *lighter* than its ground, so its pressed step goes
     down in luminance the same way light mode's does — towards the ground,
     not away from it. */
  dangerPressed: "#f04438",
  dangerSurface: "#34120f",
  dangerBorder: "#5c2019",
  warning: "#fdb022",
  warningSurface: "#33210b",
  warningBorder: "#5a3a11",
  success: brand[400],
  successSurface: "#06301c",
  successBorder: "#0a5233",
  info: "#84caff",
  infoSurface: "#0b2545",
  infoBorder: "#123a6b",

  /* Heavier than light mode's: a 40% scrim over a near-black page does not
     read as a scrim at all, and the sheet above it loses its edge. */
  scrim: "rgba(0, 0, 0, 0.60)",
  skeleton: "#201f1b",
  skeletonSheen: "#2e2b25",

  brandGradientFrom: brand[700],
  brandGradientTo: brand[950],
} as const;

/**
 * The palette's *shape*, with `string` values rather than the literals `light`
 * happens to hold. Typed off `light` so adding a colour there is a compile
 * error in `dark` until it is answered for both modes — which is the property
 * worth having — but widened, so the two are interchangeable at a component's
 * `colors.` call site.
 */
export type Palette = Record<keyof typeof light, string>;

/**
 * The Apple text ramp, in Sailo's names.
 *
 * Sizes are the iOS defaults so the app sits at the same optical scale as the
 * system UI around it, and nothing here sets a `fontFamily`: the system face is
 * the one that supports Dynamic Type, every script the 35 locales need, and
 * Arabic — which a bundled Latin font would silently fall back from.
 *
 * `lineHeight` is set on every step rather than left to the platform, because
 * the default differs between iOS and Android and a two-line title that wraps
 * at different heights is the most visible cross-platform tell there is.
 *
 * `letterSpacing` is set on every step too, and the sign flips as the size
 * grows. Type designed for body copy is spaced for body copy: set at 34pt it
 * looks slack, which is the single most reliable way to make an interface read
 * as unconsidered. Big steps pull in, small steps push out, and the label step
 * pushes out hardest because it is the only one that is effectively all-caps.
 */
export const type = {
  /** The brand moment — a welcome screen, a splash. Bigger than `display`. */
  hero: { fontSize: 44, lineHeight: 50, fontWeight: "700", letterSpacing: -1 },
  /** One big number or name a screen opens with. */
  display: { fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: -0.6 },
  /** A screen's own title, where a navigation bar is not carrying it. */
  title: { fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.3 },
  /** A section heading inside a screen. */
  heading: { fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.2 },
  /** Ordinary running text. The default. */
  body: { fontSize: 17, lineHeight: 24, fontWeight: "400", letterSpacing: -0.1 },
  /** Body, one step down — the supporting line under a title. */
  callout: { fontSize: 15, lineHeight: 21, fontWeight: "400", letterSpacing: -0.05 },
  /** The small print: hints, timestamps, footnotes. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "400", letterSpacing: 0 },
  /**
   * The group label above a list section.
   *
   * Uppercased through `letterSpacing` and weight rather than by transforming
   * the string: `textTransform` on a localised label is how "İstanbul" becomes
   * "ISTANBUL" in Turkish, where the dotted capital İ is a different letter.
   * The caller passes the string already cased as its language wants it.
   */
  label: { fontSize: 13, lineHeight: 16, fontWeight: "600", letterSpacing: 0.4 },
  /**
   * A figure that has to line up with the figure under it — a total beside a
   * subtotal, a column of amounts.
   *
   * The size is `body`'s; what differs is `fontVariant`, which switches the
   * system face to tabular figures so every digit is the same width. Without
   * it a column of prices visibly shivers as the numbers change, because `1`
   * is narrower than `8` in the proportional default.
   */
  numeric: { fontSize: 17, lineHeight: 24, fontWeight: "600", letterSpacing: -0.2 },
} as const;

/**
 * Elevation, as three steps and no more.
 *
 * `boxShadow` strings, never the legacy `shadowOffset`/`elevation` pair: the
 * old props diverge between platforms and Android's `elevation` also changes
 * z-ordering, so a card that only wanted a shadow starts covering its
 * neighbours.
 *
 * **Dark mode gets no shadow at all**, and that is the correct answer rather
 * than a shortcut. A shadow is an absence of light; on a near-black page there
 * is no light to take away, so the same string that separates a card in light
 * mode is simply invisible — the card floats on nothing and the hierarchy the
 * shadow was carrying disappears. Dark interfaces separate by *raising the
 * fill* instead, which is what `surfaceElevated` is for, and a component asks
 * for `shadow.raised` in both modes and gets the right one of the two.
 */
const lightShadow = {
  none: undefined,
  card: "0 1px 2px rgba(13, 13, 12, 0.06)",
  raised: "0 4px 12px rgba(13, 13, 12, 0.10)",
  overlay: "0 8px 24px rgba(13, 13, 12, 0.18)",
} as const;

const darkShadow: Shadow = {
  none: undefined,
  card: undefined,
  raised: undefined,
  overlay: undefined,
};

export type Shadow = Record<keyof typeof lightShadow, string | undefined>;

/**
 * The same three easings the web uses, as durations a native animation can
 * take. Everything decelerates; nothing should feel like it is still speeding
 * up when it arrives.
 */
export const motion = {
  /** Press feedback, a toggle. */
  fast: 120,
  /** An element entering or leaving. */
  base: 240,
  /** A sheet, a screen. */
  slow: 340,
  /** The brand splash handing over to the app. Once per launch. */
  splash: 520,
  /**
   * The four control points of each curve, exactly as `@sailo/tokens` holds
   * them — the same numbers `globals.css` prints as `cubic-bezier(...)`, so a
   * sheet on the phone and a sheet in the admin decelerate identically.
   *
   * Handed on as tuples rather than as `Easing` functions because that keeps
   * this module free of a `react-native` import in the one place a test might
   * want to read the numbers. `./motion` builds the functions.
   */
  curve: easing,
  /**
   * The one spring in the product, as `Animated.spring` config.
   *
   * Critically damped on purpose: `bounciness` reads as playful for about two
   * days and as unserious after that, and this is an app somebody runs a
   * business from. What the spring buys over a timing curve is that an
   * *interrupted* press — a finger lifted mid-animation — resolves from where
   * it actually is rather than snapping.
   */
  spring: { stiffness: 320, damping: 26, mass: 0.9 },
} as const;

/**
 * The smallest a control may be and still be reliably hittable.
 *
 * 44pt is Apple's floor and Android's is 48dp; taking the larger of the two
 * would make iOS rows look loose, so the primitives use 44 and Android gets a
 * hit slop rather than a taller row.
 */
export const HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 } as const;
export const MIN_TAP = 44;

/**
 * How far a pressed control shrinks.
 *
 * One number, in one place, because the thing that makes press feedback read
 * as *the product* rather than as *a component* is that every control shrinks
 * by the same amount. 0.97 is deliberately shallow: a card is much larger than
 * a button and the same *ratio* on a big surface is a much larger movement, so
 * anything deeper starts to look like the card is being pushed over rather
 * than pressed.
 */
export const PRESS_SCALE = 0.97;

export { radius, space };

export type Theme = {
  colors: Palette;
  radius: typeof radius;
  space: typeof space;
  type: typeof type;
  shadow: Shadow;
  motion: typeof motion;
  /** True when the phone is in dark mode — for the rare component that has to
   * pick an asset rather than a colour. */
  dark: boolean;
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  /*
   * Memoised on the one thing it depends on.
   *
   * Without this every `useTheme()` call returns a fresh object, so a `useMemo`
   * or `React.memo` downstream that lists `theme` in its dependencies never
   * hits — which is every list row in the app, on every parent render. The
   * palettes themselves are module constants, so the only work here is the
   * wrapper.
   */
  return useMemo(
    () => ({
      colors: isDark ? dark : light,
      radius,
      space,
      type,
      shadow: isDark ? darkShadow : lightShadow,
      motion,
      dark: isDark,
    }),
    [isDark],
  );
}

/**
 * Android's ripple, in Sailo's colours.
 *
 * `Pressable` on Android draws a Material ripple and ignores the `pressed`
 * style unless one is configured — so a control styled only through
 * `({ pressed }) => …` gets *both* feedbacks stacked, or on some OEM skins
 * neither. Every pressable in this package passes this, which makes the two
 * platforms agree: iOS gets the scale and the fill change, Android gets those
 * plus the ripple its users expect.
 *
 * `undefined` on iOS rather than a no-op object, because `android_ripple` is
 * ignored there and passing a value only invites somebody to wonder whether it
 * does something.
 */
export function ripple(color: string, borderless = false) {
  return Platform.OS === "android" ? { color, borderless, foreground: true } : undefined;
}
