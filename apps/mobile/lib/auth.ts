import * as SecureStore from "expo-secure-store";
import { createMobileAuthClient } from "@sailo/auth";

/**
 * The seller's session on the phone.
 *
 * `EXPO_PUBLIC_AUTH_URL` — the *web* origin, and deliberately not the same
 * variable the data client reads. Sessions are issued by apps/web and only by
 * apps/web: it owns the sign-in, sign-up, two-factor and magic-link routes,
 * along with the email and rate-limiting they depend on. apps/api carries a
 * verify-only better-auth instance that can read a session and never mint one,
 * so pointing sign-in at it would reach a server with no such route.
 *
 * Falling back to the data origin would therefore fail loudly at the worst
 * moment, so it falls back to production instead.
 *
 * The token lives in the device keychain via `expo-secure-store`; nothing about
 * the session touches AsyncStorage or the JS heap between launches.
 */
export const authClient = createMobileAuthClient({
  baseURL: process.env.EXPO_PUBLIC_AUTH_URL ?? "https://sailo.store",
  storage: SecureStore,
});

export const { signIn, signUp, signOut, useSession } = authClient;
