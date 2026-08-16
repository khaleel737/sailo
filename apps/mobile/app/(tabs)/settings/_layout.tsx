import { Stack } from "expo-router";
import { useT } from "../../../lib/i18n";
import { useStackScreenOptions } from "../../../lib/navigation";

/**
 * The Settings tab's own stack.
 *
 * One screen today, but the stack exists from the start rather than being added
 * when the second one arrives: account, payments and notifications all push
 * from here, and retrofitting a stack under a screen that has been living
 * without one means re-deciding every navigation call that reached it.
 *
 * Headers on — see `store/_layout.tsx` for why the root stack turns them off
 * and every per-tab stack turns them back on.
 */
export default function SettingsLayout() {
  const { a } = useT();
  const screenOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: a.shell.tabSettings }} />
      {/* The shop as a buyer sees it, and the words buyers wrote about it. Both
          are about the storefront rather than about the account, and both push
          from the settings list rather than living in a tab of their own. */}
      <Stack.Screen name="shop" options={{ title: a.settings.identity }} />
      <Stack.Screen name="reviews" options={{ title: a.reviews.title }} />
      {/* The people behind the orders. Titled by the screen once the customer
          is known, like every other detail route in the app. */}
      <Stack.Screen name="customers/index" options={{ title: a.clients.title }} />
      <Stack.Screen name="customers/[id]" options={{ title: "" }} />
      {/* The account's own commercial terms — what the plan allows, and the
          way to change the card behind it. */}
      <Stack.Screen name="billing" options={{ title: a.settings.tabBilling }} />
      <Stack.Screen name="members" options={{ title: a.members.title }} />
      {/*
        `tabNotifications` ("What to tell me about"), not `notifications`
        ("Email notifications"). The screen carries this device's *push*
        permission as well as the account's preferences, and titling the whole
        thing "Email" named the half that is not the reason a seller opens it.
      */}
      <Stack.Screen
        name="notifications"
        options={{ title: a.settings.tabNotifications }}
      />
    </Stack>
  );
}
