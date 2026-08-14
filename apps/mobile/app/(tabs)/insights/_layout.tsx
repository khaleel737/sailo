import { Stack } from "expo-router";

/**
 * The Insights tab's own stack.
 *
 * Headers on — see `store/_layout.tsx` for why the root stack turns them off
 * and every per-tab stack turns them back on.
 */
export default function InsightsLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: "#037740",
        headerTitleStyle: { color: "#1a1917" },
        headerShadowVisible: false,
      }}
    >
      {/* i18n: A05 */}
      <Stack.Screen name="index" options={{ title: "Insights" }} />
    </Stack>
  );
}
