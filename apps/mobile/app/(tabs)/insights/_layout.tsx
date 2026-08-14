import { Stack } from "expo-router";
import { useT } from "../../../lib/i18n";

/**
 * The Insights tab's own stack.
 *
 * Headers on — see `store/_layout.tsx` for why the root stack turns them off
 * and every per-tab stack turns them back on.
 *
 * The two colours below are still literals, and they are the last thing in this
 * tab that is. A navigation header is drawn by the native stack rather than by
 * anything in `@sailo/design-native`, so its tint has to be handed over as a
 * value — and this package exports components, not its theme. Reading
 * `theme.colors` here would mean importing `react-native-unistyles` in a screen,
 * which is the rule this tab otherwise holds to. Left as A00 wrote them, and
 * listed in the handoff: A01 exports the palette, these become `accent` and
 * `content`, and dark mode starts working on the header too.
 */
export default function InsightsLayout() {
  const { a } = useT();

  return (
    <Stack
      screenOptions={{
        headerTintColor: "#037740",
        headerTitleStyle: { color: "#1a1917" },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: a.insights.title }} />
    </Stack>
  );
}
