/**
 * The design tokens, once, in a form both targets can be generated from.
 *
 * WHY THIS PACKAGE EXISTS
 *
 * The web's palette lives in `apps/web/src/app/globals.css` as Tailwind
 * `@theme` variables, and the phone cannot read CSS custom properties. Left to
 * itself the app would grow a second copy of the ink and brand ramps, and the
 * two would part company the first time somebody nudged a green. So the values
 * live here as typed data, and both spellings are generated from them:
 *
 *   - `theme.css`, a Tailwind `@theme` partial that `globals.css` imports
 *   - `theme`, a plain object `@sailo/design-native` builds its styles from
 *
 * `src/generate.ts` writes the first; `tokens.test.ts` fails if what is
 * committed no longer matches what the generator would write, so a token edited
 * here without a regenerate is a red test rather than a silent divergence.
 *
 * WHAT IS AND IS NOT GENERATED
 *
 * Only the colour ramps are emitted into CSS. Radius and easing are declared
 * below because the native side needs them as numbers, but `globals.css` keeps
 * its own hand-written copies — they were there first and rewriting more of
 * that file than necessary is not worth the churn. `tokens.test.ts` reads those
 * declarations back out of `globals.css` and fails if they disagree with this
 * file, which is the same guarantee by a different route.
 *
 * Spacing is native-only. The web is on Tailwind's default 4px step and emitting
 * a `--spacing-*` override would change every existing screen; the scale below
 * is that same step, named, for a platform that has no utility classes.
 *
 * No dependencies, and deliberately no Unistyles import. A01 owns that library
 * and adding it here would force a dev client on everything downstream.
 */

/**
 * The product's one neutral, and the reason this ramp is warm.
 *
 * Copied verbatim from `globals.css`, where the prose explaining the choice
 * still lives. There used to be two greys — a violet-tinted one driving the
 * admin and a warm one on the brand pages — so walking from the landing page
 * into /admin read as walking into a different product. One family now.
 */
export const ink = {
  50: "#faf9f7",
  100: "#f0efea",
  200: "#e0ddd5",
  300: "#c2beb3",
  400: "#96928a",
  500: "#6f6b64",
  600: "#55524b",
  700: "#403d38",
  800: "#2a2824",
  900: "#1a1917",
  950: "#0d0d0c",
} as const;

/**
 * Anchored on 700 — the green lifted straight off the mark. Used by the logo,
 * the marketing page, auth and onboarding; the admin and the storefront only
 * reach for it where a screen explicitly asks.
 */
export const brand = {
  50: "#ecfdf3",
  100: "#d1fae0",
  200: "#a5f3c6",
  300: "#6ee7a7",
  400: "#34d98a",
  500: "#12b76a",
  600: "#059154",
  700: "#037740",
  800: "#065f37",
  900: "#064e2f",
  950: "#022c1a",
} as const;

/**
 * Rounder than the framework defaults, and shared.
 *
 * In px, because React Native has no other unit and the CSS side is the one
 * that needs converting. `xl` is the control radius (buttons, inputs, chips),
 * `2xl` the surface radius (cards, panels, sheets). The values are the rem
 * figures in `globals.css` at the 16px root: 0.625rem, 0.875rem, 1.25rem,
 * 1.5rem.
 */
export const radius = {
  lg: 10,
  xl: 14,
  "2xl": 20,
  "3xl": 24,
} as const;

/**
 * The 4px step, named.
 *
 * Native-only — see the header. The names are sizes rather than numbers so a
 * screen reads `space.lg` and not `space[6]`, which is the one thing a
 * utility-class-free platform can improve on.
 */
export const space = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

/**
 * The four hues a status can be, and the one place they are written down.
 *
 * Native-only, for the same reason `space` is: the web already draws its
 * badges out of Tailwind's own `emerald`, `amber`, `red` and `blue`
 * (`apps/web/src/components/ui/feedback.tsx`), and emitting a `--color-red-*`
 * override into `theme.css` would repaint every existing badge to make a point
 * about where the value lives. So the web keeps reading Tailwind's ramps and
 * the phone reads these, and `tokens.test.ts` fails if the two stop agreeing.
 *
 * The hexes are converted, not typed in. Tailwind 4 declares these in `oklch`,
 * which React Native cannot parse, so the test re-derives them from
 * `node_modules/tailwindcss/theme.css` and compares — which means a Tailwind
 * upgrade that nudges a green is a red test rather than an admin and an app
 * that quietly disagree about what "shipped" looks like.
 *
 * Named for the hue and not the meaning. Which step is a success message is a
 * decision that differs between light and dark, and it belongs to the design
 * system — see the header. This package only answers "what is emerald-700".
 */
export const status = {
  emerald: {
    50: "#ecfdf5",
    100: "#d0fae5",
    200: "#a4f4cf",
    300: "#5ee9b5",
    400: "#00d492",
    500: "#00bc7d",
    600: "#009966",
    700: "#007a55",
    800: "#006045",
    900: "#004f3b",
    950: "#002c22",
  },
  amber: {
    50: "#fffbeb",
    100: "#fef3c6",
    200: "#fee685",
    300: "#ffd230",
    400: "#ffb900",
    500: "#fe9a00",
    600: "#e17100",
    700: "#bb4d00",
    800: "#973c00",
    900: "#7b3306",
    950: "#461901",
  },
  red: {
    50: "#fef2f2",
    100: "#ffe2e2",
    200: "#ffc9c9",
    300: "#ffa2a2",
    400: "#ff6467",
    500: "#fb2c36",
    600: "#e7000b",
    700: "#c10007",
    800: "#9f0712",
    900: "#82181a",
    950: "#460809",
  },
  blue: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bedbff",
    300: "#8ec5ff",
    400: "#51a2ff",
    500: "#2b7fff",
    600: "#155dfc",
    700: "#1447e6",
    800: "#193cb8",
    900: "#1c398e",
    950: "#162456",
  },
} as const;

/**
 * Everything decelerates. Nothing here should feel like it is still
 * accelerating when it arrives.
 *
 * Held as the four control points rather than a `cubic-bezier(...)` string,
 * because that is the form React Native's animation drivers take and the CSS
 * spelling is the one that can be printed from it. Reversing that — parsing a
 * string on the phone — is work at runtime for no reason.
 */
export const easing = {
  outQuint: [0.22, 1, 0.36, 1],
  outExpo: [0.16, 1, 0.3, 1],
  spring: [0.34, 1.56, 0.64, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/**
 * How long, in milliseconds.
 *
 * Native-only, and the same figures `globals.css` gives its `--animate-*`
 * shorthands: 280ms for a backdrop, 300ms for a fade, 320ms for a pop, 340ms
 * for a sheet. Named for the job because the point of a shared scale is that a
 * sheet on the phone takes as long to arrive as a sheet on the web.
 *
 * `instant` is not zero-as-a-mistake — it is what every duration collapses to
 * when the reader has asked for reduced motion, and having a name for it is
 * what stops that being spelled as a magic `0` in nine components.
 */
export const duration = {
  instant: 0,
  /** A press, a tint change — anything that must feel like a direct response. */
  fast: 120,
  /** The default. Fades, cross-dissolves. */
  base: 300,
  /** Something with a spring in it. */
  pop: 320,
  /** A sheet or a toast travelling a real distance. */
  slow: 340,
} as const;

export type Ink = typeof ink;
export type Brand = typeof brand;
export type Status = typeof status;
export type StatusHue = keyof Status;
export type Radius = typeof radius;
export type Space = typeof space;
export type Easing = typeof easing;
export type EasingName = keyof Easing;
export type Duration = typeof duration;

/**
 * The whole set as one object, which is the shape `@sailo/design-native` wants
 * to hand to Unistyles.
 *
 * Ramps only — no `background`, no `border`, no semantic role. Those are design
 * decisions about *which* step to use where, they differ between light and dark,
 * and they belong to the design system rather than to the palette. This package
 * answers "what is ink-600"; it does not answer "what colour is a card".
 */
export const theme = {
  colors: { ink, brand, status },
  radius,
  space,
  easing,
  duration,
} as const;

export type Theme = typeof theme;

/** `cubic-bezier(…)`, for the CSS side and for anything else that speaks it. */
export function cubicBezier(name: EasingName): string {
  return `cubic-bezier(${easing[name].join(", ")})`;
}
