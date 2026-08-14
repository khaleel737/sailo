import { Stack } from "expo-router";
import { useT } from "../../../lib/i18n";

/**
 * The Home tab's own stack.
 *
 * Home was the one tab without a layout of its own — a bare `(tabs)/index.tsx`
 * beside four directories that each had one. It is a directory now for the same
 * reason they are: a stack per tab is what gives each section its own history,
 * so a seller who opens an order from Home, switches to Store and comes back is
 * still looking at that order. Route-wise this changes nothing — expo-router
 * gives an `index` directory holding an `index` route the path `/`, exactly
 * what the file it replaces had, and `(tabs)/_layout.tsx`'s
 * `<NativeTabs.Trigger name="index">` still resolves to it.
 *
 * The header is off on the screen below, and that is the whole reason this file
 * is not just a `Stack`. Home opens with the seller's shop link in a block of
 * its own — the web dashboard does the same thing, for the reason its comment
 * gives — and a native large title saying "Overview" above that block is a
 * second header competing with the first. Anything *pushed* onto this stack
 * gets a real header, with a back control, which is the trap
 * `store/_layout.tsx` documents at length.
 *
 * The two colours are copied from the three sibling stacks rather than picked:
 * they are A00's placeholders for a theme `@sailo/design-native` does not own
 * yet, and A01 replaces all four together. A fifth spelling of the same green
 * would be one more file to find.
 */
export default function HomeLayout() {
  const { t } = useT();

  return (
    <Stack
      screenOptions={{
        headerTintColor: "#037740",
        headerTitleStyle: { color: "#1a1917" },
        headerShadowVisible: false,
      }}
    >
      {/*
        `title` still earns its place with the header hidden: it is what the
        back button of a screen pushed on top of this one is labelled with.
      */}
      <Stack.Screen name="index" options={{ title: t.nav.overview, headerShown: false }} />
    </Stack>
  );
}
