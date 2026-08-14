import { Stack } from "expo-router";
import { useT } from "../../../lib/i18n";
import { useStackScreenOptions } from "../../../lib/navigation";

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
 * The look of the header comes from `useStackScreenOptions`, which is the one
 * place all six stacks read it from. It used to be a pair of hex literals
 * copied into each of them — `#1a1917` on `#0d0d0c`, which is to say an
 * invisible title on every screen in dark mode. `lib/navigation.ts` carries
 * that story.
 */
export default function HomeLayout() {
  const { t } = useT();
  const screenOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={screenOptions}>
      {/*
        `title` still earns its place with the header hidden: it is what the
        back button of a screen pushed on top of this one is labelled with.
      */}
      <Stack.Screen name="index" options={{ title: t.nav.overview, headerShown: false }} />
    </Stack>
  );
}
