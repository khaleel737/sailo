import * as SecureStore from "expo-secure-store";
import { createApiClient } from "@sailo/api/client";
import { MOBILE_SCHEME } from "@sailo/auth";

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://sailo.store";

/**
 * The typed data client the screens read through.
 *
 * It reuses the session the auth client already put in the device keychain —
 * @better-auth/expo keeps the cookie under `<scheme>_cookie` — and returns it
 * as a Cookie header, which the server's better-auth reads exactly as it reads
 * a browser's. Read fresh on every request so a sign-out takes effect at once.
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
