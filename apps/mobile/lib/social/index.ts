/**
 * Apple and Google sign-in, as the two screens above them see it.
 *
 * WHY THIS IS A DIRECTORY AND NOT A SCREEN
 *
 * The work order for this change asked for `app/(auth)/_social/`, on the
 * assumption — reasonable, and wrong for this framework — that Expo Router
 * ignores a directory whose name starts with an underscore, the way the
 * Next.js pages router does. It does not. `_layout` is the only name the
 * router treats specially; everything else under `app/` that ends in `.ts` or
 * `.tsx` becomes a navigable route, verified against expo-router 6's own
 * `getRoutes` rather than assumed. `app/(auth)/_social/apple.ts` would have
 * shipped a route that renders nothing, listed in the generated route types
 * because `experiments.typedRoutes` is on.
 *
 * So the flows live in `lib/` and the buttons in `components/`, which is where
 * this app already keeps its non-route code, and the sign-in screen mounts one
 * component. Named here rather than in a commit message because the next
 * person to read the work order will wonder why the paths disagree.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No account *linking*. Connecting and disconnecting providers belongs in
 * Settings → Security, which this change does not own and must not reach into.
 *
 * The two flows below are also inert until the server grows `socialProviders`
 * — `apps/web/src/lib/auth.ts` has none today. They compile, and they will
 * answer 404 on a device until that lands. That is the intended order: the
 * buttons and the server config ship in one release or neither ships.
 */

/**
 * How a sign-in attempt ended.
 *
 * A discriminated union rather than "threw or didn't", because three of these
 * four are ordinary and only one is a fault. A seller who backs out of the
 * Apple sheet has not hit an error and must not be shown one, and a seller who
 * needs their second factor has not failed either — collapsing those into a
 * thrown exception is how a cancel ends up rendered as "something went wrong".
 */
export type SocialOutcome =
  /** A session exists. The caller re-reads `useSession` and navigates. */
  | { status: "signed-in" }
  /** The seller dismissed the native sheet. Say nothing; they know. */
  | { status: "cancelled" }
  /**
   * The account has two-factor enabled, so the server answered a challenge
   * instead of a session. See `socialCopy.twoFactorUnavailable` for why this
   * is currently a dead end on the phone.
   */
  | { status: "two-factor" }
  /** Something genuinely went wrong. `message` is already seller-readable. */
  | { status: "error"; message: string };

/**
 * Every string these two flows can put on screen.
 *
 * Here rather than in `@sailo/i18n/native` because that entry point does not
 * exist yet — `packages/i18n` exports `./admin`, `./marketing` and
 * `./dictionaries/*` and nothing else, and adding a native one means touching
 * all 35 locale files, which this change does not own. One object in one file
 * is the smallest thing for that work to lift wholesale when it lands.
 *
 * The button *labels* are deliberately absent: Apple and Google both draw
 * their own, localised by the platform, and the review guidelines require
 * exactly their wording. There is nothing for us to translate there.
 */
export const socialCopy = {
  /** Between the email form and the provider buttons. */
  divider: "or",
  /** iOS 12 and earlier, and any Android device. The button is hidden, not disabled. */
  appleUnavailable: "Sign in with Apple needs iOS 13 or later.",
  appleFailed: "Could not sign in with Apple. Try again.",
  /** Apple authorised the seller but withheld the token. Rare, and not their fault. */
  appleNoToken: "Apple did not return a sign-in token. Try again.",
  googleFailed: "Could not sign in with Google. Try again.",
  googleNoToken: "Google did not return a sign-in token. Try again.",
  /** Android without Play services — a Huawei device, or a stripped ROM. */
  googlePlayMissing:
    "Google sign-in needs Google Play services, which this device does not have. Sign in with your email and password instead.",
  /**
   * The honest version of a bound this build genuinely has.
   *
   * A seller with two-factor enabled gets a challenge rather than a session,
   * and the phone has nowhere to send them: the verification screen is part of
   * the auth-screens work and does not exist yet. Saying so is better than a
   * spinner that never resolves — and when that screen lands, this string goes
   * and the `two-factor` outcome navigates instead.
   */
  twoFactorUnavailable:
    "This account asks for a verification code, which this version of the app cannot show yet. Sign in at sailo.store instead.",
  /**
   * The client ids are missing from the build. A developer-facing failure
   * worded for a seller, because it is the seller who would see it.
   */
  notConfigured: "Sign-in with this provider is not available in this build.",
} as const;

/**
 * Whether better-auth answered with a two-factor challenge rather than a
 * session.
 *
 * A runtime check rather than a type narrowing on purpose. `signIn.social`'s
 * response type is assembled from the plugin list, and the two-factor plugin
 * contributes `twoFactorRedirect` to the *password* path's union; whether it
 * appears on the social path's inferred type depends on plugin-inference
 * details that have moved between better-auth releases. The wire format is the
 * stable part — the server sends `{ twoFactorRedirect: true }` — so this reads
 * the wire format and does not care what the types believe.
 */
export function isTwoFactorChallenge(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "twoFactorRedirect" in data &&
    (data as { twoFactorRedirect?: unknown }).twoFactorRedirect === true
  );
}
