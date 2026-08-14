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
    </Stack>
  );
}
