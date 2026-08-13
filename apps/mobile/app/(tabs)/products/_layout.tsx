import { Stack } from "expo-router";

/**
 * The catalogue section's own stack.
 *
 * Nested inside the `(tabs)` group rather than pushed onto the root stack, so
 * that when the tab shell lands this section keeps its own history: a seller
 * who is three products deep, switches to Orders and comes back should still
 * be three products deep, which is what a per-tab stack buys and a single
 * global one does not.
 *
 * Headers are on here even though the root stack sets `headerShown: false`.
 * The root turns them off because the dashboard paints its own; a pushed
 * detail screen has no such header, and without one there is no back button —
 * on Android the hardware gesture still works, on iOS the seller is stuck.
 */
export default function ProductsLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: "#4f46e5",
        headerTitleStyle: { color: "#111827" },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Products" }} />
      {/*
        Titled by the screen itself once the product has loaded — naming it
        here as well would flash "Product" before the real title arrives.
      */}
      <Stack.Screen name="[id]" options={{ title: "" }} />
    </Stack>
  );
}
