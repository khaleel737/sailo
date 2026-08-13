import * as SecureStore from "expo-secure-store";
import { createApiClient } from "@sailo/api/client";
import { MOBILE_SCHEME } from "@sailo/auth";

/**
 * The *api* origin — apps/api, which serves `/api/trpc` and nothing that issues
 * a session. Separate from `EXPO_PUBLIC_AUTH_URL` on purpose: the two halves
 * answer on different hosts in every environment except the one where a single
 * dev server happens to serve both.
 */
const BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://sailo.store";

/**
 * The typed data client the screens read through.
 *
 * It reuses the session the auth client already put in the device keychain —
 * @better-auth/expo keeps the cookie under `<scheme>_cookie` — and returns it
 * as a Cookie header, which the server's better-auth reads exactly as it reads
 * a browser's. Read fresh on every request so a sign-out takes effect at once.
 *
 * Carried explicitly rather than by a cookie jar, which is what lets the data
 * origin differ from the auth origin: nothing here depends on the browser rule
 * that a cookie only travels back to the host that set it.
 */
export const api = createApiClient({
  url: `${BASE}/api/trpc`,
  headers: async () => {
    const cookie = await SecureStore.getItemAsync(`${MOBILE_SCHEME}_cookie`);
    const headers: Record<string, string> = {};
    if (cookie) headers.Cookie = cookie;
    return headers;
  },
});
