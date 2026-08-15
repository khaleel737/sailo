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
      {/* Which products carry the shop. Pushed rather than stacked onto the
          tab's own screen: it is a table, and a table under two charts is a
          screen a seller scrolls past rather than reads. */}
      <Stack.Screen name="products" options={{ title: a.performance.title }} />
    </Stack>
  );
}
