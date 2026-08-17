import { Stack } from "expo-router";
import { useAuthCopy } from "../../lib/auth-copy";
import { useStackScreenOptions } from "../../lib/navigation";

/**
 * The signed-out stack — everything between a fresh install and a shop.
 *
 * It is a stack rather than a set of loose routes because this flow has a
 * *back*. A seller who taps "Create an account" and changes their mind, or who
 * reaches the two-factor challenge and wants to check they typed the right
 * email, has somewhere to go — and on iOS that somewhere is the system's own
 * edge swipe, which only exists if these screens are pushed onto a stack.
 *
 * Titles live here rather than in each screen so the flow's shape is readable
 * in one file, and so a screen never sets a header title that disagrees with
 * the heading printed underneath it.
 *
 * `initialRouteName` is Welcome, and it is doing real work: it is what puts
 * Welcome *underneath* whichever screen the app lands on, so the back gesture
 * reaches it instead of dead-ending.
 *
 * **The one-line follow-up this file used to name is done.**
 * `(tabs)/_layout.tsx` sent a signed-out seller to `/sign-in`, so a fresh
 * install opened on a password form — the one question a new seller cannot
 * answer, and the reason Welcome exists at all. It now sends them to
 * `/welcome`. The note said the fix was one line in a tab layout that A06 was
 * not allowed to write to; this change owns both files, so it is written.
 */
export const unstable_settings = { initialRouteName: "welcome" };

export default function AuthLayout() {
  const copy = useAuthCopy();
  const screenOptions = useStackScreenOptions();

  return (
    <Stack
      screenOptions={{
        ...screenOptions,
        /*
         * No large titles in this flow, and this is the one stack that opts
         * out.
         *
         * A large title collapses into the bar as its screen scrolls, which is
         * the right behaviour for a list you are browsing and the wrong one for
         * a four-field form: the seller's first action is to focus a field, the
         * keyboard pushes the content, and the title animates away for a scroll
         * nobody performed. These screens carry their own heading in the
         * content instead, which is also what keeps the heading and the bar
         * from saying the same word twice.
         */
        headerLargeTitle: false,
      }}
    >
      {/* Brand screen. A header above a wordmark is two titles. */}
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: copy.signIn.title }} />
      <Stack.Screen name="sign-up" options={{ title: copy.signUp.title }} />
      <Stack.Screen name="two-factor" options={{ title: copy.twoFactor.title }} />
      <Stack.Screen name="verify-email" options={{ title: copy.verifyEmail.title }} />
      <Stack.Screen name="get-paid" options={{ title: copy.getPaid.title }} />
    </Stack>
  );
}

/*
 * ---------------------------------------------------------------------------
 * THE ONE STYLE RULE EVERY SCREEN IN HERE USED TO CARRY, AND NO LONGER DOES
 * ---------------------------------------------------------------------------
 *
 * Each screen below declared its own `StyleSheet.create({ fill: { flex: 1 },
 * body: { padding: 20, gap: 16 } })`, because the frozen component API had no
 * screen root: there were twenty components and every one of them was
 * *content*, while a screen also needs something that fills the window so a
 * `ScrollView` inside it has a height to scroll against.
 *
 * That exception was supposed to be one grep-able rule per file. It was not.
 * The auth screens padded at 20 and the tab screens at 16, so walking from
 * sign-in into the app visibly shifted the margins — and **two of the six
 * screens here never applied their `body` style at all**, because they passed
 * `style={styles.fill}` and forgot `contentContainerStyle`. `verify-email` and
 * `get-paid` rendered with no padding and no gap, edge to edge against the
 * bezel, for as long as they have existed.
 *
 * `Screen` in `@sailo/design-system` is the component that was missing. It owns
 * the fill, the page colour, the safe-area edges, the keyboard behaviour, the
 * padding and the entrance, and every `styles.fill` in this directory is
 * deleted with it. The class of mistake goes with the instances: there is no
 * longer a second style object that has to be remembered.
 */
