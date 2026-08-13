import { useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { init } from "@sailo/observability";
import { api } from "../lib/api";
import { usePushRegistration } from "../lib/push";
import { TRPCProvider, makeQueryClient, useAppFocusRefetch } from "../lib/query";

// One call, at the app's entry: today it logs; a Sentry DSN swaps the sink in
// without touching a single captureError elsewhere.
init();

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
    <QueryClientProvider client={queryClient}>
      {/*
        `api` is the same vanilla tRPC client `lib/api.ts` has always exported —
        the provider wraps it rather than replacing it, so an imperative call
        outside React still goes through one transport with one token.
      */}
      <TRPCProvider trpcClient={api} queryClient={queryClient}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </TRPCProvider>
    </QueryClientProvider>
  );
}
