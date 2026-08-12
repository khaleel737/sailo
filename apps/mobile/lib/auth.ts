import * as SecureStore from "expo-secure-store";
import { createMobileAuthClient } from "@sailo/auth";

/**
 * The seller's session on the phone.
 *
 * `EXPO_PUBLIC_API_URL` points at the same Sailo server the web app runs on —
 * production by default, overridden to a laptop's LAN address in development.
 * The token lives in the device keychain via `expo-secure-store`; nothing about
 * the session touches AsyncStorage or the JS heap between launches.
 */
export const authClient = createMobileAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL ?? "https://sailo.store",
  storage: SecureStore,
});

export const { signIn, signUp, signOut, useSession } = authClient;
