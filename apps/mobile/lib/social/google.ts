import { Platform } from "react-native";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { captureError } from "@sailo/observability";
import { authClient } from "../auth";
import { isTwoFactorChallenge, socialCopy, type SocialOutcome } from "./index";

/**
 * Continue with Google, through the native sheet.
 *
 * Not `expo-auth-session` and not a browser redirect. On a phone the redirect
 * flow means a Safari view opening, a consent page, and a hop back into the
 * app that the seller can lose their way out of; the native sheet is one modal
 * over the app, already signed in to the accounts on the device. The
 * conversion difference on a sign-in screen is the whole reason to carry the
 * extra dependency.
 *
 * THE THREE CLIENT IDS
 *
 * Google issues a separate OAuth client per platform, and all three matter:
 *
 *   - **Web** — the one the server holds, with the secret. The identity token
 *     this flow produces is minted *for* it, which is why `webClientId` is set
 *     below even though nothing here is a browser.
 *   - **iOS** — identifies the app to Google on iOS, and supplies the reversed
 *     URL scheme the config plugin writes into the Info.plist.
 *   - **Android** — never named in code at all. Google matches the Android app
 *     by package name plus signing-certificate SHA-1, which is why every EAS
 *     build profile's fingerprint has to be registered separately: development
 *     working and release failing is exactly what a missing one looks like.
 *
 * The iOS and web ids are public and ride in `EXPO_PUBLIC_`. The secret never
 * leaves the server.
 *
 * Whichever id Google stamps the token's `aud` with, the server has to accept
 * — better-auth passes its configured `clientId` straight through as the
 * expected audience, and it takes an array. All three belong in it.
 *
 * ⚠ THE iOS URL SCHEME IN `app.json` IS A PLACEHOLDER.
 *
 * The config plugin writes `iosUrlScheme` into the Info.plist, and it has to be
 * the iOS client id with its dot-separated parts reversed —
 * `com.googleusercontent.apps.<id>`. That value is not a secret, but it is also
 * not something this change could invent: the OAuth clients have not been
 * created yet. `app.json` currently carries
 * `com.googleusercontent.apps.EXPO-PUBLIC-GOOGLE-IOS-CLIENT-ID`, which passes
 * the plugin's format check and will fail at runtime with a redirect-URI
 * mismatch until it is replaced. It is spelled out here because `app.json` is
 * strict JSON with nowhere to leave a note.
 */

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/**
 * Whether the build carries the ids at all.
 *
 * Read once at module scope: `EXPO_PUBLIC_*` is substituted at bundle time, so
 * these are literals by the time the app runs and cannot change underneath us.
 */
export const isGoogleSignInConfigured = Boolean(webClientId);

let configured = false;

/**
 * `configure` is synchronous, idempotent in practice, and required before the
 * first `signIn`. Done lazily rather than at import so that a build missing the
 * ids fails at the point the seller taps the button — with a message — instead
 * of at startup with a blank screen.
 */
function configureOnce(): void {
  if (configured) return;
  GoogleSignin.configure({
    webClientId,
    /*
     * iOS only, and harmlessly ignored on Android. Left undefined rather than
     * defaulted: the library reads the value out of the Info.plist the config
     * plugin wrote when it is absent here.
     */
    iosClientId,
  });
  configured = true;
}

/**
 * Google's cancel, in both of the shapes this library has used.
 *
 * v16 resolves `{ type: "cancelled" }` rather than throwing, which is the path
 * that actually runs today. The thrown `SIGN_IN_CANCELLED` is the older
 * behaviour and is still matched, because the alternative — a version bump
 * quietly turning "the seller changed their mind" into a red error — is the
 * kind of regression nothing catches.
 */
function isCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === statusCodes.SIGN_IN_CANCELLED
  );
}

export async function signInWithGoogle(): Promise<SocialOutcome> {
  if (!isGoogleSignInConfigured) {
    return { status: "error", message: socialCopy.notConfigured };
  }
  configureOnce();

  try {
    if (Platform.OS === "android") {
      /*
       * Throws rather than returning false when Play services are missing or
       * too old, and offers to update them when that is the problem. A Huawei
       * device or a stripped ROM genuinely cannot do this, and the copy sends
       * those sellers to the email form rather than leaving them stuck.
       */
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
    }

    /*
     * Clear the cached native credential before asking.
     *
     * Without this the library reuses whichever Google account signed in last
     * and never shows the chooser — so a seller who signed out of Sailo to
     * switch accounts gets silently put back into the one they were leaving,
     * with no visible way to pick the other. Signing out here rather than from
     * the Settings screen keeps the fix inside this flow, and the cost is one
     * account-picker tap on a screen where picking an account is the point.
     */
    await GoogleSignin.signOut();

    const result = await GoogleSignin.signIn();
    if (result.type === "cancelled") return { status: "cancelled" };

    const token = result.data.idToken;
    if (!token) {
      /*
       * Signed in, but no identity token — which in practice means
       * `webClientId` is wrong or missing, since that is what the token is
       * minted for. Nothing to send the server, so nothing to do but say so.
       */
      captureError(new Error("Google sign-in returned no idToken"), {
        scope: "mobile:auth:google",
      });
      return { status: "error", message: socialCopy.googleNoToken };
    }

    const reply = await authClient.signIn.social({
      provider: "google",
      /*
       * No nonce. This library does not offer one — the classic
       * `GoogleSignin.signIn()` takes no such option — and better-auth only
       * checks a nonce when it is given one. The token is still audience-bound
       * to our own client ids, signature-verified against Google's keys, and
       * short-lived, which is the verification Google itself documents for a
       * backend. Worth knowing rather than assuming it is there.
       */
      idToken: { token },
    });

    if (reply.error) {
      captureError(reply.error, { scope: "mobile:auth:google" });
      return {
        status: "error",
        message: reply.error.message ?? socialCopy.googleFailed,
      };
    }

    if (isTwoFactorChallenge(reply.data)) return { status: "two-factor" };

    return { status: "signed-in" };
  } catch (error) {
    if (isCancellation(error)) return { status: "cancelled" };

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code ===
        statusCodes.PLAY_SERVICES_NOT_AVAILABLE
    ) {
      return { status: "error", message: socialCopy.googlePlayMissing };
    }

    captureError(error, { scope: "mobile:auth:google" });
    return { status: "error", message: socialCopy.googleFailed };
  }
}
