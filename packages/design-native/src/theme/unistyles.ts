import { duration, easing, radius, space } from "@sailo/tokens";
import { StyleSheet } from "react-native-unistyles";
import { components } from "./components";
import { darkPalette, lightPalette } from "./palette";
import { fontWeights, typeScale } from "./typography";

/**
 * The runtime: two themes, four breakpoints, and the one call that starts it.
 *
 * WHY THIS RUNS ON IMPORT
 *
 * `StyleSheet.configure` has to happen before the first `StyleSheet.create`,
 * and every component in this package calls `create` at module scope. So
 * `src/index.ts` imports this file first, for its side effect, and ES module
 * evaluation order does the rest — a screen that imports `Button` from
 * `@sailo/design-native` has already configured the runtime by the time
 * `button.tsx` is evaluated. There is deliberately no `initTheme()` for a
 * screen to call and forget.
 *
 * ADAPTIVE, NOT TOGGLED
 *
 * `adaptiveThemes: true` follows the system appearance, which is what
 * `app.json`'s `userInterfaceStyle: "automatic"` already promises the OS. Dark
 * mode ships the day this does; there is no in-app switch, because a seller who
 * has set their phone to dark at sunset has already answered the question.
 */

/** What both themes share: the scales, which do not have a light and a dark. */
const scales = {
  radius,
  space,
  easing,
  duration,
  type: typeScale,
  fontWeights,
  components,
} as const;

export const lightTheme = { ...scales, colors: lightPalette } as const;
export const darkTheme = { ...scales, colors: darkPalette } as const;

/**
 * Four widths, named for the device rather than for a number.
 *
 * `xs` must be 0 — Unistyles needs a breakpoint that always matches, and a
 * style with no floor is a style that vanishes on the narrowest phone. `lg`
 * exists for a landscape phone and for the iPad this app does not ship on yet
 * (`supportsTablet: false`), not as an invitation to build a tablet layout.
 */
const breakpoints = {
  xs: 0,
  /** A small phone — SE, mini. */
  sm: 360,
  /** The ordinary phone. */
  md: 400,
  /** A large phone, or one on its side. */
  lg: 700,
} as const;

type AppBreakpoints = typeof breakpoints;

declare module "react-native-unistyles" {
  export interface UnistylesThemes {
    light: typeof lightTheme;
    dark: typeof darkTheme;
  }
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

StyleSheet.configure({
  themes: { light: lightTheme, dark: darkTheme },
  breakpoints,
  settings: { adaptiveThemes: true },
});
