import * as SecureStore from "expo-secure-store";
import { captureError } from "@sailo/observability";
import { createMobileAuthClient } from "@sailo/auth";
import { interpolate } from "@sailo/i18n/native";
import { useT } from "./i18n";

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

/*
 * ---------------------------------------------------------------------------
 * Reading what the server actually said
 * ---------------------------------------------------------------------------
 *
 * Everything below this line exists so that no screen ever reads a raw
 * better-auth reply. Three of the ways this flow goes wrong are ways of
 * misreading one, and each of them is a bug you only find with a real account
 * on a real network:
 *
 *   - **A two-factor challenge is not a failure.** A password sign-in for an
 *     enrolled seller answers `{ twoFactorRedirect: true }` and no session.
 *     Code that checks "did I get a session" and shows the error line
 *     otherwise tells a seller with correct credentials that they are wrong.
 *
 *   - **A throttled answer is not a negative.** 429 means the server declined
 *     to look, so it knows nothing about the password and neither do we.
 *     `apps/web/src/lib/auth.ts` is explicit about this for the two-factor
 *     limiter — "a throttled attempt is *unknown*, not *wrong*" — and the same
 *     holds for every limited endpoint. Rendering "wrong password" for one
 *     sends a seller off to reset a password that was fine.
 *
 *   - **Some refusals are deliberately indistinguishable.** `/sign-up/email`
 *     answers 422 "User already exists" both for a genuinely taken address and
 *     for a staff address that may not hold a password at all, and
 *     `/sign-in/email` answers 401 for both a wrong password and a staff
 *     address. That cover only works if the app does not decorate it, so the
 *     screens render their own copy from the *kind* below and never the
 *     server's sentence.
 *
 * Doing this in one place rather than in five screens is the point: there is
 * one reading of a reply to get right, and one place to fix when better-auth's
 * client types finally describe the challenge shape.
 */

/**
 * What the server said when it did not hand back a session.
 *
 * A closed set rather than a message, because the screens have to *behave*
 * differently — a throttle offers a wait, a rejection offers another go at the
 * password, a conflict offers sign-in instead — and a string forces every one
 * of them to guess by matching on words the server is free to reword.
 */
export type AuthRefusal =
  /** 429. The endpoint declined to look. Says nothing about the credentials. */
  | { kind: "throttled" }
  /** 401. The credentials did not check out. */
  | { kind: "rejected" }
  /** 422. The address is already an account. */
  | { kind: "conflict" }
  /**
   * Anything else — the network, a 5xx, a shape nobody predicted. `detail` is
   * the server's own sentence when there is one, shown *beside* the screen's
   * copy rather than instead of it.
   */
  | { kind: "failed"; detail: string | null };

/**
 * The minimum the server will accept, restated here so a field can say so
 * before the round trip rather than after it.
 *
 * `apps/web/src/lib/auth.ts` sets `minPasswordLength: 8`. Duplicated rather
 * than imported because that module is Next-only — it pulls in the drizzle
 * adapter, the mailer and `next/headers` — and none of that belongs in a phone
 * bundle to learn one integer. If the server's minimum moves, this moves with
 * it; the server is still the one that decides, and a short password is
 * refused there whatever this says.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * The reply shape every better-auth client method shares, narrowed to the two
 * fields this file reads.
 *
 * Structural rather than imported: the client's own error type varies by
 * method and by plugin, and pinning to one of them would break the next time a
 * plugin is added. What is stable — and what better-auth documents — is that a
 * refusal carries the HTTP status and, sometimes, a message.
 */
type Refusal = { status?: number; message?: string } | null | undefined;

function classify(error: Refusal): AuthRefusal {
  switch (error?.status) {
    case 429:
      return { kind: "throttled" };
    case 401:
      return { kind: "rejected" };
    case 422:
      return { kind: "conflict" };
    default:
      /*
       * The one branch worth reporting, and the reason it is worth it: 401,
       * 429 and 422 are answers — the seller sees a sentence that tells them
       * what to do next. Everything else lands here as "something went wrong",
       * which is the honest thing to *show* and useless to debug from. A
       * transport failure, a 500, a TLS refusal and a body the client could not
       * parse are all indistinguishable on the screen and all different in the
       * log.
       */
      captureError(new Error(error?.message || "Sign-in failed with no status"), {
        scope: "mobile:auth:unclassified",
        extra: { status: error?.status ?? null },
      });
      return { kind: "failed", detail: error?.message?.trim() || null };
  }
}

/**
 * Whether this reply is a two-factor challenge, and which methods are offered.
 *
 * Read structurally, and deliberately. better-auth's own client plugin reaches
 * for `context.data?.twoFactorRedirect` in a fetch hook rather than through a
 * type, and the client's inferred `data` for `signIn.email` describes the
 * session case only — so a cast to a union that TypeScript has not been told
 * about would be a lie that compiles. This asks the object what it is.
 *
 * The empty array is a real answer and not a miss: the challenge is genuine
 * and the server simply did not enumerate the methods, which the screen
 * handles by offering both the ones this deployment has.
 */
function twoFactorChallenge(data: unknown): readonly string[] | null {
  if (typeof data !== "object" || data === null) return null;
  const shape = data as { twoFactorRedirect?: unknown; twoFactorMethods?: unknown };
  if (shape.twoFactorRedirect !== true) return null;
  return Array.isArray(shape.twoFactorMethods)
    ? shape.twoFactorMethods.filter((method): method is string => typeof method === "string")
    : [];
}

/** A sign-in ends in a session, a challenge, or a refusal. There is no fourth. */
export type SignInOutcome =
  | { kind: "session" }
  | { kind: "twoFactor"; methods: readonly string[] }
  | AuthRefusal;

/**
 * Email and password.
 *
 * The session is not returned. `authClient.useSession()` is the one thing that
 * knows whether there is one, every gate in the app already watches it, and
 * handing a screen a second copy would let the two disagree for the frame
 * between them.
 */
export async function attemptSignIn(credentials: {
  email: string;
  password: string;
}): Promise<SignInOutcome> {
  const reply = await authClient.signIn.email({
    email: credentials.email.trim(),
    password: credentials.password,
  });

  const methods = twoFactorChallenge(reply.data);
  if (methods) return { kind: "twoFactor", methods };
  if (reply.error) return classify(reply.error);
  return { kind: "session" };
}

/** A code either completes the challenge or it does not. */
export type TwoFactorOutcome = { kind: "session" } | AuthRefusal;

/**
 * The two verify endpoints, addressed by path rather than through
 * `authClient.twoFactor.verifyTotp()`.
 *
 * **That method does not exist on the client's type, and the reason is worth
 * knowing before anyone "fixes" this back.** `packages/auth/src/index.ts`
 * carries a `@ts-expect-error` on the `expoClient` element of its plugins array
 * — a real upstream variance bug, documented there — and suppressing an error
 * on one element degrades the array's element type, so better-auth's
 * `InferActions` walks a list it can no longer read and contributes nothing.
 * The result is a client whose *runtime* has the two-factor plugin on it and
 * whose *type* has none of its actions. That package's own comment claims every
 * method the app calls "resolves to a real server route rather than a type that
 * lies"; today the type is simply missing instead.
 *
 * `$fetch` is better-auth's own escape hatch and goes through the same fetch
 * plugins, so the Expo client still writes the returned session to the keychain
 * and the plugin's `atomListeners` — which match on this path prefix — still
 * poke `useSession` into refetching. Nothing is bypassed but the inference.
 *
 * The paths are the plugin's own, from its `pathMethods` map. This is the one
 * thing that would break silently if better-auth renamed a route, which is why
 * they are named together here rather than inlined at two call sites.
 *
 * Delete this and go back to the typed methods once A00 resolves the
 * `@ts-expect-error` in `packages/auth` — that package is not A06's to edit.
 */
const TWO_FACTOR_PATHS = {
  totp: "/two-factor/verify-totp",
  backupCode: "/two-factor/verify-backup-code",
} as const;

/**
 * The second factor.
 *
 * Two endpoints behind one function because they are one decision to the
 * seller — "the code from my app" or "one of the codes I wrote down" — and
 * because the failure handling is identical, including the limiter in front of
 * both of them (`apps/web/src/lib/auth.ts` meters the pair together, keyed on
 * the user rather than the address).
 *
 * Nothing is passed in from the sign-in screen. better-auth carries the
 * pending challenge in a signed cookie that `@better-auth/expo` has already
 * put in the keychain, so the challenge survives this screen being reached by
 * a fresh navigation — and, unlike a value threaded through a route param, it
 * cannot be replayed by anything that can read a URL.
 */
export async function verifyTwoFactor(attempt: {
  code: string;
  using: "totp" | "backupCode";
}): Promise<TwoFactorOutcome> {
  const reply = await authClient.$fetch(TWO_FACTOR_PATHS[attempt.using], {
    method: "POST",
    body: { code: attempt.code.trim() },
  });

  if (reply.error) return classify(reply.error);
  return { kind: "session" };
}

/** Sign-up lands a session immediately — see `requireEmailVerification` below. */
export type SignUpOutcome = { kind: "session" } | AuthRefusal;

/**
 * A new account.
 *
 * There is no verification gate in front of the session, and that is the
 * server's decision rather than a shortcut taken here:
 * `apps/web/src/lib/auth.ts` sets `requireEmailVerification: false` so a seller
 * can build their shop while the confirmation sits in their inbox, with a nag
 * until they click it. The phone mirrors that. Gating the app on a click in
 * another application is how a new seller ends up stuck on a launch screen
 * because their mail app is signed into a different account.
 */
export async function attemptSignUp(details: {
  name: string;
  email: string;
  password: string;
}): Promise<SignUpOutcome> {
  const reply = await authClient.signUp.email({
    name: details.name.trim(),
    email: details.email.trim(),
    password: details.password,
  });

  if (reply.error) return classify(reply.error);
  return { kind: "session" };
}

/** Asking for the confirmation email again. */
export type ResendOutcome = { kind: "sent" } | AuthRefusal;

/**
 * Sends the confirmation email again.
 *
 * The tightest limit on the server — eight per fifteen minutes — because it
 * puts mail in an address the caller chose, so a throttle here is ordinary
 * rather than exceptional and the screen has to be able to say "not yet"
 * without implying anything went wrong.
 *
 * `callbackURL` is the app's own scheme. The confirmation link is opened from
 * a mail client, and without this better-auth sends the seller to the website
 * afterwards — a second place to be signed in, on a device where they were
 * already signed in, and no way back to the app but the home screen.
 */
export async function resendVerificationEmail(email: string): Promise<ResendOutcome> {
  const reply = await authClient.sendVerificationEmail({
    email: email.trim(),
    callbackURL: "sailo://verified",
  });

  if (reply.error) return classify(reply.error);
  return { kind: "sent" };
}

/*
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO MAGIC-LINK HELPER HERE
 * ---------------------------------------------------------------------------
 *
 * `packages/auth/src/index.ts` wires `magicLinkClient()`, so `signIn.magicLink`
 * exists on this client and typechecks. **Do not call it from a seller
 * screen.** It is the staff door, not a second way for a seller to sign in.
 *
 * `apps/web/src/lib/auth.ts`'s `sendMagicLink` refuses every address that is
 * not on the /hq roster — `isStaffEmail`, which defaults to one address — and
 * refuses it *silently*, because the endpoint has to answer identically either
 * way or it becomes a test for who works here. A seller who tapped "email me a
 * link" would get a success response, a waiting screen, and no email, forever.
 *
 * Opening it to sellers is a server change with a security condition attached,
 * spelled out in the comment above `twoFactor()` in that same file: a
 * magic-link sign-in bypasses the 2FA challenge, and that is only acceptable
 * today because the two doors admit disjoint sets of people. Point sellers at
 * this endpoint without also gating it for 2FA-enrolled users and every seller
 * who turned on two-factor has a way in that skips it.
 *
 * A06's work order asks for the two magic-link screens and also says it needs
 * no server change. Both cannot be true. The screens are left unbuilt rather
 * than built as a waiting room for mail that is never sent.
 */
