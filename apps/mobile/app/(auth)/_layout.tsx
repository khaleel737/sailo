import { Stack } from "expo-router";
import { useAuthCopy } from "../../lib/auth";

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
 * `initialRouteName` is Welcome, and it is doing real work. `(tabs)/_layout.tsx`
 * sends a signed-out seller to `/sign-in`, so that is where a fresh install
 * lands; naming Welcome as this stack's anchor is what puts it *underneath*
 * sign-in in the history, so the back gesture reaches it instead of dead-ending.
 *
 * **A06 could not make Welcome the landing screen itself.** That is one line in
 * `(tabs)/_layout.tsx` — `<Redirect href="/sign-in" />` becoming `/welcome` —
 * and that file is a tab layout, which this work order may not write to. It is
 * named in the PR as a one-line follow-up rather than reached across for.
 */
export const unstable_settings = { initialRouteName: "welcome" };

export default function AuthLayout() {
  const copy = useAuthCopy();

  return (
    <Stack>
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
 * ON THE ONE STYLE RULE EVERY SCREEN IN HERE CARRIES
 * ---------------------------------------------------------------------------
 *
 * Each screen below declares exactly one style — `{ flex: 1 }` on its scroll
 * root — and nothing else. No colour, no spacing, no type size: those come from
 * `@sailo/design-native`, which is the rule.
 *
 * That one rule is here because the frozen component API has no screen root.
 * There are twenty components and every one of them is content — a `Button`, a
 * `TextField`, a `Card` — while a screen also needs something that *fills the
 * window* so a `ScrollView` inside it has a height to scroll against. Without
 * it the content lays out at its natural height and anything past the fold is
 * simply cut off, which is not a styling preference, it is the screen not
 * working on a small phone.
 *
 * **This is an A01 request, not a local component.** The right shape is a
 * `Screen` in `@sailo/design-native` owning the fill, the safe-area edges, the
 * scroll behaviour and the form padding — at which point every `styles.fill`
 * below is deleted and the screens read as pure composition. Until then the
 * exception is one grep-able rule per file, deliberately too small to hide a
 * look inside.
 */
