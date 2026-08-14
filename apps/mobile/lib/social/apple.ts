import * as AppleAuthentication from "expo-apple-authentication";
import { randomUUID } from "expo-crypto";
import { captureError } from "@sailo/observability";
import { authClient } from "../auth";
import { isTwoFactorChallenge, socialCopy, type SocialOutcome } from "./index";

/**
 * Sign in with Apple, through the system sheet.
 *
 * Not a browser hop: `signInAsync` raises the same modal the OS raises for
 * every other app, so Face ID is already there and there is nothing for the
 * seller to dismiss afterwards. The token it hands back goes straight to
 * better-auth, which verifies Apple's signature server-side.
 *
 * Mandatory rather than optional, incidentally: App Store Review Guideline 4.8
 * requires an equivalent privacy-preserving login wherever a third-party
 * social login is offered, so this ships in the same binary as Google or
 * neither of them ships.
 */

/**
 * Apple's cancel. Not an error, and it must not be rendered as one.
 *
 * The module rejects with an `Error` carrying `code: "ERR_REQUEST_CANCELED"`
 * (one "L" — that is Apple's spelling, not a typo here). Matched on the code
 * rather than the message because the message is localised.
 */
function isCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ERR_REQUEST_CANCELED"
  );
}

/**
 * Whether this device can do it at all.
 *
 * Android always answers false, and so does iOS 12 and earlier. The caller
 * hides the button rather than disabling it: a greyed-out "Sign in with Apple"
 * on an Android phone is an invitation to tap something that can never work.
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    // The module throws rather than resolving false on a device without the
    // native side linked — a bare Expo Go client, say. Same answer either way.
    return false;
  }
}

export async function signInWithApple(): Promise<SocialOutcome> {
  /*
   * Replay protection, and the reason it is generated here rather than taken
   * from the server: it only has to be unbound-to-anything and used once.
   * Apple copies it into the identity token, better-auth compares it back, and
   * a token captured from one attempt is then useless in another.
   *
   * better-auth's Apple provider accepts either the raw value or its SHA-256
   * (`nonceMatches` in @better-auth/core), which is what makes passing the raw
   * string safe here: Apple stamps the token with exactly what it was given,
   * and the hashed convention some SDKs use is accepted too. `randomUUID` is
   * 122 bits from the platform CSPRNG, which is well past what this needs.
   */
  const nonce = randomUUID();

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      /*
       * Both scopes, because both are only ever offered *once*. Apple returns
       * the name and email on the very first authorisation for this Apple ID
       * and never again — not on the next sign-in, not after a reinstall. Not
       * asking here means never being able to ask.
       */
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    });
  } catch (error) {
    if (isCancellation(error)) return { status: "cancelled" };
    captureError(error, { scope: "mobile:auth:apple" });
    return { status: "error", message: socialCopy.appleFailed };
  }

  const token = credential.identityToken;
  if (!token) {
    // Authorised, but no JWT — nothing to verify server-side, so there is no
    // sign-in to attempt. Worth capturing: it should not happen.
    captureError(new Error("Apple credential carried no identityToken"), {
      scope: "mobile:auth:apple",
    });
    return { status: "error", message: socialCopy.appleNoToken };
  }

  const reply = await authClient.signIn.social({
    provider: "apple",
    idToken: {
      token,
      nonce,
      /*
       * The one chance to keep the seller's name.
       *
       * `fullName` is populated on the first authorisation and is null on
       * every one after it, so if this call drops it, it is gone for that
       * Apple ID permanently — a reinstall does not bring it back. The server
       * persists whatever arrives here and derives a placeholder when nothing
       * does, because `user.name` is NOT NULL.
       *
       * Only the name is forwarded. The email is left to the identity token,
       * where it is a signed claim Apple stands behind rather than a field
       * this process filled in — including the `@privaterelay.appleid.com`
       * address a seller using Hide My Email gets.
       */
      user: appleName(credential.fullName),
    },
  });

  if (reply.error) {
    captureError(reply.error, { scope: "mobile:auth:apple" });
    return {
      status: "error",
      message: reply.error.message ?? socialCopy.appleFailed,
    };
  }

  if (isTwoFactorChallenge(reply.data)) return { status: "two-factor" };

  return { status: "signed-in" };
}

/**
 * Apple's five-part name, narrowed to the two parts better-auth stores.
 *
 * Returns undefined rather than an object of nulls when there is nothing to
 * send, so the field is simply absent from the request. An empty-string name
 * would satisfy the NOT NULL column and leave the seller called "" forever,
 * which is worse than the placeholder the server derives when the field is
 * missing.
 */
function appleName(
  fullName: AppleAuthentication.AppleAuthenticationFullName | null,
): { name: { firstName?: string; lastName?: string } } | undefined {
  const firstName = fullName?.givenName?.trim();
  const lastName = fullName?.familyName?.trim();
  if (!firstName && !lastName) return undefined;
  return {
    name: {
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
    },
  };
}
