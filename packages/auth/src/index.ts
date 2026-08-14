import { createAuthClient } from "better-auth/react";
import { expoClient, getCookie } from "@better-auth/expo/client";
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

/**
 * The session, as a `Cookie` header value.
 *
 * **What is in the keychain is not a cookie header, and this is the only thing
 * standing between the two.** `@better-auth/expo` keeps its jar under
 * `<storagePrefix>_cookie` as a *JSON object* — `{"<name>":{"value":…,
 * "expires":…}}` — because it has to remember expiries in order to drop a
 * cookie the way a browser would. Read that string out and send it as a
 * `Cookie` header and the server receives a JSON blob with no `name=value` pair
 * in it, finds no session token, and answers UNAUTHORIZED to every request.
 *
 * The failure is quiet in the worst way: better-auth's *own* calls keep working,
 * because its fetch plugin runs the jar through this same conversion before it
 * sends. So sign-in succeeds, `useSession` reports a session, and only the calls
 * the app makes itself — every tRPC query in the product — come back
 * unauthenticated. It reads as "the API is broken", not "the header is wrong".
 *
 * `getCookie` is the plugin's own serialiser rather than a reimplementation
 * here, so an expired entry is dropped by the same rule that wrote it, and a
 * change to the jar's shape moves this with it. It cannot be reached through
 * `authClient.getCookie()` — the `@ts-expect-error` above degrades the plugins
 * array's element type, so better-auth's `InferActions` contributes none of the
 * Expo plugin's actions to the client's type. The runtime has them; the type
 * does not.
 */
export function sessionCookieHeader(storage: Pick<SecureStorage, "getItem">): string {
  return getCookie(storage.getItem(`${MOBILE_SCHEME}_cookie`) ?? "{}");
}
