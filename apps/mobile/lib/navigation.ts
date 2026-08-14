import type { ComponentProps } from "react";
import { Platform } from "react-native";
import type { Stack } from "expo-router";
import { useTheme } from "@sailo/design-native";

/**
 * What every navigation header in the app looks like.
 *
 * THE BUG THIS EXISTS TO FIX
 *
 * Five `_layout.tsx` files each carried the same two lines:
 *
 *     headerTintColor: "#037740",
 *     headerTitleStyle: { color: "#1a1917" },
 *
 * `#1a1917` is `ink-900`. On the dark page — `ink-950`, `#0d0d0c` — that is a
 * near-black title on a near-black bar, and **every screen title in the app was
 * effectively invisible in dark mode**: Orders, Store, Insights, Settings, and
 * every pushed detail screen. `#037740` is `brand-700`, the deep green, which
 * is the back chevron and every header button — those were unreadable too.
 *
 * It was known. Each of those files carries a comment saying the two colours
 * are "A00's placeholders for a theme `@sailo/design-native` does not own yet"
 * and that "A01 replaces all four together". This is that replacement, and it
 * is one function rather than five pairs of literals so the sixth layout cannot
 * reintroduce them.
 *
 * WHY IT IS HERE AND NOT IN THE DESIGN SYSTEM
 *
 * These are navigation options, which is the router's vocabulary. Putting them
 * in `@sailo/design-native` would give a package that draws boxes a dependency
 * on the router — and the package is consumed by exactly one app, so the seam
 * buys nothing. The colours come from the theme; only their *spelling* as
 * navigation options lives here.
 */

/**
 * What `<Stack screenOptions>` accepts, read off the component rather than
 * imported from React Navigation.
 *
 * `NativeStackNavigationOptions` is `@react-navigation/native-stack`'s type,
 * and this app does not declare that package — it arrives hoisted, as a
 * transitive dependency of `expo-router`. Naming it directly is an undeclared
 * import: it typechecks today because pnpm's hoisted layout puts it at the
 * root, and it is exactly the sort of thing that breaks on a linker change
 * with no warning. `expo-router` is the dependency this app actually has, so
 * the type comes from its surface.
 *
 * `Exclude` drops the callback arm of the union. `screenOptions` also accepts a
 * function of the route, which is a perfectly good thing for a layout to pass
 * and a useless thing for this to *return* — and leaving it in the union means
 * `{ ...screenOptions, headerShown: true }` stops compiling, which is what
 * `checkin/_layout.tsx` does.
 */
type StackScreenOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack>["screenOptions"]>,
  (...args: never[]) => unknown
>;

export function useStackScreenOptions(): StackScreenOptions {
  const { colors, type } = useTheme();

  return {
    /* The back chevron and any header button. */
    headerTintColor: colors.accent,
    headerTitleStyle: {
      color: colors.content,
      fontSize: type.heading.fontSize,
      fontWeight: type.heading.fontWeight,
    },
    /*
     * The bar itself.
     *
     * `background` rather than `surface`, so the bar and the page under it are
     * one colour and the boundary between them is the hairline below rather
     * than a step in tone. Without it the bar is the platform's default —
     * white on iOS regardless of the scheme, because a native stack does not
     * read `useColorScheme` on the app's behalf.
     */
    headerStyle: { backgroundColor: colors.background },
    /*
     * Large titles on iOS, which is the platform's own convention for a tab's
     * root screen and the thing that makes a native stack read as native. It
     * collapses into the bar as the content scrolls — behaviour a JavaScript
     * header cannot reproduce and the main reason these are native stacks.
     *
     * iOS only: Android's Material top bar has no equivalent, and forcing one
     * produces a very tall bar with a small title in it.
     */
    headerLargeTitle: Platform.OS === "ios",
    headerLargeTitleStyle: { color: colors.content },
    /* The large-title bar is transparent over the page until it collapses, so
       it must not paint its own colour on top of the scrolled content. */
    headerLargeTitleShadowVisible: false,
    headerShadowVisible: false,
    /*
     * The colour behind a push.
     *
     * Without this the native stack animates a *white* card in from the edge in
     * dark mode — the one-frame flash that reads as the app blinking on every
     * navigation.
     */
    contentStyle: { backgroundColor: colors.background },
    /* Back to the previous screen's title, not to the word "Back". iOS
       truncates it on its own when the title is long. */
    headerBackButtonDisplayMode: "minimal",
  };
}
