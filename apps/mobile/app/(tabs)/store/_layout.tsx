import { Stack } from "expo-router";

/**
 * The Store tab's own stack — the catalogue, and the product behind each row.
 *
 * Nested inside the `(tabs)` group rather than pushed onto the root stack, so
 * that this section keeps its own history: a seller who is three products deep,
 * switches to Orders and comes back should still be three products deep, which
 * is what a per-tab stack buys and a single global one does not.
 *
 * Headers are on here even though the root stack sets `headerShown: false`.
 * The root turns them off because the old dashboard painted its own; a pushed
 * detail screen has no such header, and without one there is no back button —
 * on Android the hardware gesture still works, on iOS the seller is stuck. The
 * other three per-tab stacks turn them on for the same reason.
 *
 * This file was `products/_layout.tsx` until the tab shell landed. The tab is
 * "Store" because that is what a seller calls the thing buyers see; the
 * catalogue is what it opens on, and the product editor A08 builds goes here.
 */
export default function StoreLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: "#037740",
        headerTitleStyle: { color: "#1a1917" },
        headerShadowVisible: false,
      }}
    >
      {/* i18n: A05 */}
      <Stack.Screen name="index" options={{ title: "Products" }} />
      {/*
        Titled by the screen itself once the product has loaded — naming it
        here as well would flash "Product" before the real title arrives.
      */}
      <Stack.Screen name="[id]" options={{ title: "" }} />
    </Stack>
  );
}
