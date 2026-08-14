import { Redirect } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SafeAreaView } from "react-native-safe-area-context";
import { authClient } from "../../lib/auth";
import { useNotificationRouting } from "../../lib/push";
import { Loading } from "../../components/states";

/**
 * The five tabs, and the gate in front of them.
 *
 * Until now `app/(tabs)/` had no layout at all, which meant there was no tab
 * bar and four of the six screens in it were unreachable — you could only get
 * to a route by typing it. This file is what makes the app navigable.
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
   */
  if (isPending) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <Loading />
      </SafeAreaView>
    );
  }

  if (!session?.user) return <Redirect href="/sign-in" />;

  return (
    /*
     * The green from the mark, for the selected tab and nothing else.
     * Hard-coded against the token package here because the design system does
     * not own the tab bar yet; A01 replaces this with the themed value, which
     * is the one that knows what to do in dark mode.
     */
    <NativeTabs tintColor="#037740">
      {/*
        SF Symbols only. Android renders these tabs with their labels and no
        icon, which is a real gap and a deliberate one: the icon-name-to-glyph
        mapping belongs to `@sailo/design-native`'s `Icon`, A01 owns it, and
        picking an Android icon family here would commit the whole product to
        that choice from a layout file.

        The filled variant on selection is the iOS convention — an outline that
        stays an outline when active reads as nothing having happened.

        Every label below is an English literal, which breaks the rule that
        mobile strings come from `@sailo/i18n/native`. That module does not
        exist yet — A05 creates it, and A05 runs after this — so these five are
        marked rather than hidden. They are the first strings A05 should move.
      */}
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        {/* i18n: A05 */}
        <Label>Home</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="orders">
        <Icon sf={{ default: "bag", selected: "bag.fill" }} />
        {/* i18n: A05 */}
        <Label>Orders</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="store">
        <Icon sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }} />
        {/* i18n: A05 */}
        <Label>Store</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="insights">
        <Icon sf={{ default: "chart.bar", selected: "chart.bar.fill" }} />
        {/* i18n: A05 */}
        <Label>Insights</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        {/* i18n: A05 */}
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
