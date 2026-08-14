import { Stack } from "expo-router";
import { useT } from "../../../lib/i18n";
import { useStackScreenOptions } from "../../../lib/navigation";

/**
 * The Insights tab's own stack.
 *
 * Headers on — see `store/_layout.tsx` for why the root stack turns them off
 * and every per-tab stack turns them back on.
 */
export default function InsightsLayout() {
  const { a } = useT();
  const screenOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: a.shell.tabInsights }} />
    </Stack>
  );
}
