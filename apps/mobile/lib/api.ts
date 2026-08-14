import * as SecureStore from "expo-secure-store";
import { createApiClient } from "@sailo/api/client";
import { sessionCookieHeader } from "@sailo/auth";

/**
 * The *api* origin — apps/api, which serves `/api/trpc` and nothing that issues
 * a session. Separate from `EXPO_PUBLIC_AUTH_URL` on purpose: the two halves
 * answer on different hosts in every environment except the one where a single
 * dev server happens to serve both.
 *
 * The fallback is the api host, not the web one. It used to be
 * `https://sailo.store`, written when the plan was to put both halves behind a
 * single origin; that cutover never happened, and apps/web has no `/api/trpc`
 * to answer with, so an unset variable meant every request 404ed rather than
 * failing anywhere near the missing configuration. Now the default is simply
 * where the API actually is.
 *
 * Point it at `http://localhost:3002` in `.env.local` to work against a local
 * `pnpm --filter @sailo/api-server dev`.
 */
const BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.sailo.store";

/**
 * The typed data client the screens read through.
 *
 * It reuses the session the auth client already put in the device keychain and
 * returns it as a Cookie header, which the server's better-auth reads exactly
 * as it reads a browser's. Read fresh on every request so a sign-out takes
 * effect at once.
 *
 * `sessionCookieHeader` rather than the stored string itself: the keychain
 * holds better-auth's jar as JSON, not as a header, and the difference is
 * invisible until every authenticated request comes back UNAUTHORIZED while
 * sign-in keeps working. That note lives on the function, in the package that
 * owns the jar's key.
 *
 * Carried explicitly rather than by a cookie jar, which is what lets the data
 * origin differ from the auth origin: nothing here depends on the browser rule
 * that a cookie only travels back to the host that set it.
 */
export const api = createApiClient({
  url: `${BASE}/api/trpc`,
  headers: async () => {
    const cookie = sessionCookieHeader(SecureStore);
    const headers: Record<string, string> = {};
    if (cookie) headers.Cookie = cookie;
    return headers;
  },
});
