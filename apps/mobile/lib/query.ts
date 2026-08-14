import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { QueryClient, focusManager } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { captureError } from "@sailo/observability";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@sailo/api/client";

/**
 * How the app reads. Decided once, here.
 *
 * `lib/api.ts` is the transport — a vanilla tRPC client that knows the URL and
 * the token. This is the layer above it: caching, retries, and when a screen
 * asks again. It exists as its own module because the alternative was every
 * screen hand-rolling `useState`/`useEffect`, which is what `index.tsx` did —
 * and four screens hand-rolling it is four subtly different answers to "what
 * does the user see while this loads, and what happens when it fails".
 *
 * Typed off `AppRouter` imported from `@sailo/api/client` rather than the
 * package root: the root pulls in the router *value*, which imports @sailo/db,
 * and Metro would follow that all the way to `pg` before failing to bundle it.
 * The `/client` entry is type-only in that direction, so it erases.
 */

export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<AppRouter>();

/**
 * A refused request is an answer, not a blip.
 *
 * The default policy retries everything three times, which for a 401 means the
 * seller waits through three round trips and two backoffs before the app
 * admits they are signed out. Nothing about a 4xx changes if you ask again:
 * `UNAUTHORIZED` needs a sign-in, `NOT_FOUND` needs a different id, and
 * `BAD_REQUEST` needs different input. Only the server failing and the network
 * dropping are worth a second go.
 */
const MAX_ATTEMPTS = 3;

function worthRetrying(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_ATTEMPTS) return false;
  const status =
    error instanceof TRPCClientError
      ? (error.data as { httpStatus?: number } | null | undefined)?.httpStatus
      : undefined;
  return !(typeof status === "number" && status >= 400 && status < 500);
}

export function makeQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        /*
         * Half a minute. A seller's own shop is not a live ticker — they open
         * the app, look at orders, tap into one and come back — and at
         * `staleTime: 0` every one of those steps is a fresh round trip over a
         * phone network to show data that has not changed. Long enough that
         * moving around the app is instant, short enough that anything they
         * are actually watching refreshes on the next focus.
         */
        staleTime: 30_000,
        retry: worthRetrying,
        /*
         * Backed by `useAppFocusRefetch` below — without that wiring this flag
         * is inert on a phone, because there is no window to focus.
         */
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        /*
         * Never automatically. A write that timed out may still have landed,
         * so retrying it is how one tap becomes two orders. The contract has
         * no mutations yet; this is the default they will inherit when it does.
         */
        retry: false,
      },
    },
  });

  return client;
}

/**
 * Makes "refetch when the user comes back" mean something on a phone.
 *
 * TanStack Query's `refetchOnWindowFocus` listens for a browser focus event
 * that React Native does not have, so on its own it never fires. The native
 * equivalent is the app returning to the foreground — a seller who backgrounds
 * the app, takes an order over the phone and comes back expects to see it.
 *
 * `AppState` also reports `inactive` (iOS, mid-swipe or in the app switcher),
 * which is deliberately treated as not-focused rather than as a return.
 */
export function useAppFocusRefetch(): void {
  useEffect(() => {
    const onChange = (status: AppStateStatus) =>
      focusManager.setFocused(status === "active");
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, []);
}

/**
 * Report a query failure, unless the failure is an answer.
 *
 * `lib/query.ts` already refuses to *retry* a 4xx, on the grounds that nothing
 * about it changes if you ask again. This is the same judgement applied to
 * reporting: an `UNAUTHORIZED` is the server correctly telling a signed-out
 * caller to sign in, and every tab fires its queries on mount before the gate
 * in `(tabs)/_layout.tsx` has redirected — so a cold start with no session
 * produced five "errors" that were all the system working.
 *
 * The cost of getting this wrong is not noise, it is deafness. Those five
 * filled LogBox on every launch and would have filled Sentry the day a DSN was
 * set, at which point nobody reads the reports and a real failure arrives in a
 * pile of expected ones.
 *
 * `NOT_FOUND` is deliberately *not* on this list. A missing procedure is what a
 * stale deployment looks like from the client, and that is exactly the thing
 * worth waking somebody for.
 */
export function reportQueryError(error: unknown, context: { scope: string }): void {
  const code =
    error instanceof TRPCClientError
      ? (error.data as { code?: string } | null | undefined)?.code
      : undefined;
  if (code === "UNAUTHORIZED") return;
  captureError(error, context);
}
