import { useEffect, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { init } from "@sailo/observability";
import { BrandSplash, useTheme } from "@sailo/design-system/native";
import { api } from "../lib/api";
import { authClient } from "../lib/auth";
import { useAuthCopy } from "../lib/auth-copy";
import { usePushRegistration } from "../lib/push";
import { TRPCProvider, makeQueryClient, useAppFocusRefetch } from "../lib/query";
import { startSentry } from "@sailo/observability/native";

/*
 * One call, at the app's entry, and the only place a vendor is named.
 *
 * `startSentry` returns null when `EXPO_PUBLIC_SENTRY_DSN` is unset, and `init`
 * treats that as "keep the console sink" — which is what local dev and CI want,
 * and what keeps the app runnable for anyone who has not been given the DSN.
 * Every `captureError` elsewhere in the app is unchanged either way; that was
 * the point of `@sailo/observability` being a seam rather than a wrapper.
 */
init(startSentry(process.env.EXPO_PUBLIC_SENTRY_DSN) ?? undefined);

export default function RootLayout() {
  /*
   * Held in state rather than built at module scope, so Fast Refresh editing
   * this file does not swap the cache out from under mounted screens — and so
   * a future test can mount the tree twice without the two sharing one cache.
   */
  const [queryClient] = useState(makeQueryClient);
  useAppFocusRefetch();
  /*
   * At the root because it has to survive the screen the seller signed in on
   * unmounting. It watches the session rather than the mount, so the device is
   * registered on the sign-in that follows a cold start and on the one that
   * follows a sign-out on a shared handset.
   */
  usePushRegistration();

  return (
    /*
     * The gesture root, outermost and exactly once.
     *
     * Every `react-native-gesture-handler` gesture — including the ones inside
     * the chart, which arrive through `victory-native` rather than through any
     * file in this app — has to be a descendant of one of these or it simply
     * never fires. There is no error: the touch lands, nothing happens, and the
     * component looks broken rather than unmounted.
     *
     * It is at the root and not around the chart because the failure mode of a
     * *second* root is worse than the failure mode of no root — nested roots
     * fight over which one claims a touch, and the symptom is a gesture that
     * works everywhere except when it is inside something that scrolls.
     *
     * `flex: 1` is load-bearing. Without a height the view collapses and takes
     * the whole app with it; a blank screen is the usual first symptom of
     * having written this without a style.
     */
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        {/*
          `api` is the same vanilla tRPC client `lib/api.ts` has always exported —
          the provider wraps it rather than replacing it, so an imperative call
          outside React still goes through one transport with one token.
        */}
        <TRPCProvider trpcClient={api} queryClient={queryClient}>
          <Shell />
        </TRPCProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });

/**
 * Everything that needs the theme, which the root cannot have.
 *
 * `useTheme()` is a hook, and the providers above have to be mounted before
 * anything under them renders — so the chrome that reads a colour lives one
 * component down rather than being wrapped around the providers.
 */
function Shell() {
  const { colors, dark } = useTheme();
  const copy = useAuthCopy();

  /*
   * The window's own background, set natively.
   *
   * React Native paints the root view, but there is a layer *under* it — the
   * Android window and the iOS root view controller — that the framework leaves
   * at the platform default, which is white. It shows in exactly three places,
   * all of which are visible and none of which a screen can reach: behind an
   * over-scroll bounce, behind the native stack's push animation, and for the
   * frame between the launch image going away and React mounting. On a dark
   * page every one of those is a white flash.
   */
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return (
    <>
      {/*
        `style` explicitly, not `auto`.

        `auto` asks the *system* appearance, which is right until the app is
        ever given a theme override — and it is wrong right now on Android,
        where `auto` resolves once at mount and does not re-evaluate on a
        scheme flip. Reading the same `dark` the rest of the app reads means the
        bar and the page can never disagree.
      */}
      <StatusBar style={dark ? "light" : "dark"} />

      <Stack
        screenOptions={{
          headerShown: false,
          /* The colour behind a push. Without it the native stack animates a
             white card in from the edge on a dark page. */
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {/* The scanner is a task, not a place — it comes up over the tabs
            rather than replacing them. `checkin/_layout.tsx` says why. */}
        <Stack.Screen
          name="checkin"
          options={{ presentation: Platform.OS === "ios" ? "modal" : "card" }}
        />
      </Stack>

      <LaunchCover tagline={copy.welcome.tagline} />
    </>
  );
}

/**
 * The brand screen that covers the app until it knows who is using it.
 *
 * WHAT IT REPLACES
 *
 * The session is read from the keychain, so on a cold start there is a real
 * moment where the answer to "is anybody signed in" is "not yet". Four files
 * handled that moment and all four handled it identically and wrongly — a bare
 * `ActivityIndicator` centred on an unpainted background. So the launch
 * sequence was: the native splash, a white flash, a spinner, and then either
 * the app or a sign-up prompt. On a warm start the spinner was up for two
 * frames, which does not read as loading; it reads as the app stuttering.
 *
 * Each of those four screens still has its own `isPending` branch, and that is
 * correct — they are guards against rendering the wrong thing, and they must
 * stay. This simply means nobody ever sees one.
 *
 * `BrandSplash` itself is `pointerEvents="none"` for its whole life, so the app
 * underneath is live and interactive the entire time. It covers; it does not
 * gate.
 */
function LaunchCover({ tagline }: { tagline: string }) {
  const { isPending } = authClient.useSession();
  /*
   * One-way, and that is the point.
   *
   * `useSession` reports `isPending` again on a *re-fetch* — which happens on
   * every foreground, and on the sign-out that clears it. Driving the cover
   * from `isPending` alone would put the launch screen back over the app every
   * time the seller returned to it from their messages. It goes up once, comes
   * down once, and never returns for the life of the process.
   */
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!isPending) setSettled(true);
  }, [isPending]);

  return <BrandSplash visible={!settled} tagline={tagline} testID="brand-splash" />;
}
