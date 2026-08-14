import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect } from "expo-router";
/* `VectorIcon` ships from the native-tabs entry point rather than the package
   root, alongside the `Icon` it is passed to. */
import { Icon, Label, NativeTabs, VectorIcon } from "expo-router/unstable-native-tabs";
import { authClient } from "../../lib/auth";
import { useNotificationRouting } from "../../lib/push";
import { Screen, Skeleton, useTheme } from "@sailo/design-native";
import { useT } from "../../lib/i18n";

/**
 * The five tabs, and the gate in front of them.
 *
 * `NativeTabs` rather than a JavaScript tab bar: it is a real `UITabBarController`
 * on iOS and a real `BottomNavigationView` on Android, so it inherits the
 * system's own materials, its blur behaviour when content scrolls under it, and
 * its Dynamic Type and Reduce Motion handling for free. Nothing here sets a
 * background colour on purpose — a tab bar painted with a brand green is a
 * coloured slab that looks foreign on both platforms, and the accent belongs on
 * what is interactive. `tintColor` is the one exception: the selected tab.
 *
 * Each tab gets its own `_layout.tsx` and therefore its own history. A seller
 * three products deep who checks Orders and comes back should still be three
 * products deep, which is what a stack per tab buys and one global stack does
 * not. `store/_layout.tsx` carries the longer note on the header trap that goes
 * with it.
 */

/**
 * The auth gate.
 *
 * It lives here rather than in a screen because it is a property of the whole
 * signed-in surface: every tab under this layout needs a session, and putting
 * the check in one of them would leave the other four reachable by a deep link
 * or a push tap. `app/_layout.tsx` would be the other candidate, but it also
 * hosts the sign-in route — a gate there would have nowhere to send anybody.
 */
export default function TabsLayout() {
  const { a } = useT();
  const { colors } = useTheme();
  const { data: session, isPending } = authClient.useSession();

  /*
   * Tapping an order notification lands on that order, from a warm start and
   * from a cold one. Here rather than at the root because this is the first
   * point with both a signed-in seller and a router that has `/orders/[id]` in
   * it; `lib/push.ts` carries the note on why the cold case needs its own
   * lookup. Above the early returns, because hooks do not get to be conditional
   * — it no-ops until there is somewhere to navigate to.
   */
  useNotificationRouting();

  /*
   * The session is read from the keychain, so on a cold start there is a real
   * moment where the answer is "not yet". Redirecting during it would bounce a
   * signed-in seller to the sign-in screen and back on every launch.
   *
   * Nobody sees this: `app/_layout.tsx` holds the brand splash over the whole
   * app for exactly as long as this branch is live. It is still here because a
   * guard whose correctness depends on something two files away covering it is
   * not a guard. What changed is *what* it draws — a skeleton of the screen
   * that is coming rather than the spinner that used to be here, so on the one
   * path where the splash has already lifted and a refetch is in flight, the
   * layout does not collapse and jump.
   */
  if (isPending) {
    return (
      <Screen scroll={false} edges={["top", "bottom"]} testID="tabs-loading">
        <Skeleton shape="title" />
        <Skeleton shape="card" count={3} />
      </Screen>
    );
  }

  /*
   * A fresh install lands on Welcome, not on a password form.
   *
   * This was `/sign-in`, and `(auth)/_layout.tsx` has carried a note about it
   * since Welcome was written: dropping somebody who has just installed the app
   * onto a password form asks the one question a new seller cannot answer, and
   * every app that does it loses the people who do not yet have an account to
   * answer it with. The note called it "a one-line follow-up" that A06 could not
   * make because this is a tab layout it was not allowed to write to.
   *
   * A returning seller loses nothing: Welcome's second button is sign-in, and
   * `unstable_settings.initialRouteName` in the auth stack already anchors the
   * flow so the back gesture works from either direction.
   */
  if (!session?.user) return <Redirect href="/welcome" />;

  return (
    /*
     * The green from the mark, for the selected tab and nothing else. Read from
     * the theme rather than hard-coded, so dark mode gets the lifted accent —
     * `brand-700` is a deep green that reads as near-black on a dark tab bar.
     */
    <NativeTabs tintColor={colors.accent}>
      {/*
        SF Symbols on iOS, and — new here — real icons on Android.

        This used to be `sf` only, with a comment calling the Android gap "real
        and deliberate": the icon-name-to-glyph mapping belongs to
        `@sailo/design-native`, and picking an Android icon family from a layout
        file would have committed the product to it. So Android rendered five
        tabs with labels and no icons at all, which on Material is not a style
        choice — it is a bottom bar that looks unfinished.

        `androidSrc` closes it without making that commitment. expo-router
        rasterises a `VectorIcon` into a drawable at mount, and the family it
        rasterises is **Ionicons — the same one `Icon` in the design system
        already draws from**, so there is no second icon set and no second
        optical weight. The names below are the exact values that component's
        own `GLYPHS` table maps `home`, `orders`, `store`, `insights` and
        `settings` to.

        The filled variant on selection is the convention on both platforms —
        an outline that stays an outline when active reads as nothing having
        happened.

        The labels come from `a.shell.*` — the section that holds the app's own
        chrome, as opposed to any one screen's content.
      */}
      <NativeTabs.Trigger name="(home)">
        <Icon
          sf={{ default: "house", selected: "house.fill" }}
          androidSrc={{
            default: <VectorIcon family={Ionicons} name="home-outline" />,
            selected: <VectorIcon family={Ionicons} name="home" />,
          }}
        />
        <Label>{a.shell.tabHome}</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="orders">
        <Icon
          sf={{ default: "bag", selected: "bag.fill" }}
          androidSrc={{
            default: <VectorIcon family={Ionicons} name="receipt-outline" />,
            selected: <VectorIcon family={Ionicons} name="receipt" />,
          }}
        />
        <Label>{a.shell.tabOrders}</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="store">
        <Icon
          sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }}
          androidSrc={{
            default: <VectorIcon family={Ionicons} name="grid-outline" />,
            selected: <VectorIcon family={Ionicons} name="grid" />,
          }}
        />
        <Label>{a.shell.tabStore}</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="insights">
        <Icon
          sf={{ default: "chart.bar", selected: "chart.bar.fill" }}
          androidSrc={{
            default: <VectorIcon family={Ionicons} name="stats-chart-outline" />,
            selected: <VectorIcon family={Ionicons} name="stats-chart" />,
          }}
        />
        <Label>{a.shell.tabInsights}</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <Icon
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
          androidSrc={{
            default: <VectorIcon family={Ionicons} name="settings-outline" />,
            selected: <VectorIcon family={Ionicons} name="settings" />,
          }}
        />
        <Label>{a.shell.tabSettings}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
