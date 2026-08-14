import { Stack } from "expo-router";
import { useT } from "../../../lib/i18n";
import { useStackScreenOptions } from "../../../lib/navigation";

/**
 * The Orders tab's own stack.
 *
 * Headers on, for the reason `store/_layout.tsx` sets out at length: the root
 * stack turns them off because the old dashboard painted its own, and a pushed
 * detail screen that inherits that has no back button on iOS.
 *
 * The hand-rolled "‹ Orders" control `[id].tsx` used to draw — from before this
 * stack existed — is gone, so the back affordance under this header is the
 * system's own and there is only one of it.
 */
export default function OrdersLayout() {
  const { a } = useT();
  const screenOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: a.shell.tabOrders }} />
      {/* Titled by the screen once the order has loaded, like the product one. */}
      <Stack.Screen name="[id]" options={{ title: "" }} />
    </Stack>
  );
}
