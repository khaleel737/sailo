import type { ComponentProps } from "react";
import type { Stack } from "expo-router";
import { useTheme } from "@sailo/design-system/native";

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
 * are "A00's placeholders for a theme `@sailo/design-system` does not own yet"
 * and that "A01 replaces all four together". This is that replacement, and it
 * is one function rather than five pairs of literals so the sixth layout cannot
 * reintroduce them.
 *
 * WHY IT IS HERE AND NOT IN THE DESIGN SYSTEM
 *
 * These are navigation options, which is the router's vocabulary. Putting them
 * in `@sailo/design-system` would give a package that draws boxes a dependency
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
     * NO LARGE TITLES, AND THIS IS THE DECISION THE SCREENS ARE BUILT ON.
     *
     * They were on, and they broke two things at once on device:
     *
     *   - On a screen whose root is not a scroll view — Orders, Store, both of
     *     which own a `FlashList` — iOS drew the large title *over* the top of
     *     the content. The search field and the status filter on Orders were
     *     underneath it, invisible, on the screen whose entire job is finding
     *     an order.
     *   - On a screen whose root *is* a scroll view nested inside a
     *     `SafeAreaView`, iOS reserved the large title's height and then drew
     *     nothing in it. Insights opened with about a hundred points of empty
     *     page above the range control and no title anywhere.
     *
     * Both are the same underlying thing: a large title is a contract with a
     * scroll view, and `Screen` legitimately does not always have one to offer.
     *
     * Beyond the bugs, they are the wrong idiom here. A large title is for a
     * screen you *arrive at and read* — Notes, Mail, Settings. Every screen in
     * this app opens with a control the seller came to use: a range, a filter,
     * a search. Spending 52 points of a phone on a word the tab bar has already
     * said, above the thing they came for, is the clutter this pass is removing.
     */
    headerLargeTitle: false,
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
