import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { magicLinkClient, twoFactorClient } from "better-auth/client/plugins";

/**
 * The one Sailo shipped auth surface, reached from two clients.
 *
 * The web client lives in apps/web and rides cookies. The mobile app has no
 * cookie jar, so it carries the session as a bearer token instead — issued and
 * read by the `bearer()` plugin on the server, kept in the device's secure
 * store, and returned through the app's deep-link scheme by the `expo()`
 * plugin. That server half is wired in apps/web's auth config; this is the
 * client half the native app builds on.
 */

/** The Expo app's deep-link scheme — matches app.json and the server's trusted origin. */
export const MOBILE_SCHEME = "sailo";

/**
 * Where the token lives on the device. Structural on purpose: the package does
 * not depend on `expo-secure-store` itself, so it stays buildable off a phone
 * and the app hands in whichever secure store it already has.
 */
export type SecureStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

/**
 * The native auth client, mirroring the server's plugins so every method the
 * app calls — email/password, two-factor, the staff magic link — resolves to a
 * real server route rather than a type that lies.
 */
export function createMobileAuthClient(opts: {
  baseURL: string;
  storage: SecureStorage;
}) {
  return createAuthClient({
    baseURL: opts.baseURL,
    plugins: [
      /*
       * @better-auth/expo 1.6.27's `expoClient` plugin declares `getActions`
       * with a `BetterFetch` generic that doesn't satisfy `createAuthClient`'s
       * `BetterAuthClientPlugin` under `strict`, even though the two ship at
       * the same version and this is the exact shape better-auth's own Expo
       * docs use. The mismatch is purely in the type, not the runtime, and it
       * sits on this one element so the other plugins keep their inference.
       * Delete the directive when upstream aligns the generic — TypeScript
       * will flag it as unused the moment it does.
       */
      // @ts-expect-error — upstream plugin-type variance; see note above.
      expoClient({
        scheme: MOBILE_SCHEME,
        storagePrefix: MOBILE_SCHEME,
        storage: opts.storage,
      }),
      twoFactorClient(),
      magicLinkClient(),
    ],
  });
}

export type MobileAuthClient = ReturnType<typeof createMobileAuthClient>;
