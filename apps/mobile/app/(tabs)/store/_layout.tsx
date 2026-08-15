import { Stack } from "expo-router";
import { useT } from "../../../lib/i18n";
import { useStackScreenOptions } from "../../../lib/navigation";

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
 * catalogue is what it opens on, and the editor is a sheet rather than a third
 * route — it is opened from both screens under here, and a route would have
 * given a half-typed product a back button and a URL.
 */
export default function StoreLayout() {
  /*
   * The stack's own title, from the same dictionary the catalogue under it
   * reads. A layout is where a title has to come from — `Stack.Screen` sets it
   * before the screen mounts — so this is the one component in the tab that
   * needs the dictionary without rendering a word of its own.
   */
  const { a } = useT();
  const screenOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: a.products.title }} />
      {/*
        Titled by the screen itself once the product has loaded — naming it
        here as well would flash "Product" before the real title arrives.
      */}
      <Stack.Screen name="[id]" options={{ title: "" }} />

      {/*
        Payments lives under Store rather than under Settings, and the choice
        is about what a seller is doing when they come here. Setting up a way
        to be paid is part of opening a shop — it sits beside the catalogue and
        the delivery options, all three of which decide what a buyer sees. A
        seller looking for it in Settings is looking for their own account.

        The rail screen is titled by itself once the rail is known, for the
        same reason the product screen is.
      */}
      <Stack.Screen name="payments/index" options={{ title: a.payments.title }} />
      <Stack.Screen name="payments/[type]" options={{ title: "" }} />

      {/* The other two things that decide what a buyer sees: how the catalogue
          is grouped, and how it reaches them. */}
      <Stack.Screen name="categories" options={{ title: a.categories.title }} />
      <Stack.Screen name="delivery" options={{ title: a.delivery.title }} />
      <Stack.Screen name="coupons" options={{ title: a.coupons.title }} />
    </Stack>
  );
}
