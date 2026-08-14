import { Stack } from "expo-router";

/**
 * The Orders tab's own stack.
 *
 * Headers on, for the reason `store/_layout.tsx` sets out at length: the root
 * stack turns them off because the old dashboard painted its own, and a pushed
 * detail screen that inherits that has no back button on iOS.
 *
 * Note for whoever takes the orders screens: `[id].tsx` still draws its own
 * `TopBar` with a "‹ Orders" control, from when there was no header to rely on.
 * With this stack in place that is now a second back affordance under the real
 * one. Removing it is a change to a screen body, which this work order does not
 * make — it is the first thing to delete when that screen is next opened.
 */
export default function OrdersLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: "#037740",
        headerTitleStyle: { color: "#1a1917" },
        headerShadowVisible: false,
      }}
    >
      {/* i18n: A05 */}
      <Stack.Screen name="index" options={{ title: "Orders" }} />
      {/* Titled by the screen once the order has loaded, like the product one. */}
      <Stack.Screen name="[id]" options={{ title: "" }} />
    </Stack>
  );
}
