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

/*
 * ---------------------------------------------------------------------------
 * THE AUTH FLOW'S WORDS — A SEAM, NOT A HOME
 * ---------------------------------------------------------------------------
 *
 * **This block belongs in `packages/i18n/src/admin/*.ts` as an `auth:` group,
 * and it is here only because that package is A05's exclusive path.** There is
 * no `auth` group in the admin dictionary today — nine of these screens are net
 * new, so none of their words has ever existed anywhere — and adding thirty-five
 * files' worth of keys from this work order would be writing inside somebody
 * else's ownership.
 *
 * So it is staged: one contiguous block, in dictionary shape, English only.
 * Lifting it is a cut and a paste into `admin/en.ts` under `auth:`, after which
 * `en.ts` is the typed source and the other thirty-four fail to compile until
 * they are translated — which is the mechanism working as designed, not a
 * regression. The only edit on this side is the body of `useAuthCopy()` below,
 * which becomes `return useT().a.auth`. **No screen changes**, because every
 * screen already reads through that one function.
 *
 * It is in this file rather than beside the screens for a reason worth knowing:
 * expo-router turns *every* `.ts` and `.tsx` file under `app/` into a route.
 * A `strings.ts` in `app/(auth)/` would become a route with no default export,
 * which warns on every dev boot and lands in the typed-`href` union as
 * something linkable. `lib/auth.ts` is the one path this work order owns that
 * the router does not read.
 *
 * The placeholder convention is the dictionaries' own — `{name}`, substituted
 * by `interpolate` from `@sailo/i18n/native` — so the strings move without
 * being rewritten.
 */
export const AUTH_COPY = {
  welcome: {
    tagline: "Your shop, in your pocket.",
    body: "Take orders, get paid and see what's selling — without opening a laptop.",
    create: "Create an account",
    signIn: "I already have an account",
    /*
     * The three lines beside the marks on the welcome screen.
     *
     * They are the product's promise in the seller's terms rather than a
     * feature list: what they will be able to *do*, one verb each. A welcome
     * screen with two buttons and nothing else asks somebody to commit to an
     * app they have been told nothing about, and this is the cheapest possible
     * answer to "what is this".
     */
    sellTitle: "Take orders anywhere",
    sellBody: "A shop link buyers can open, and orders that land on your phone.",
    payTitle: "Get paid properly",
    payBody: "Card, cash or bank transfer — whatever works where you are.",
    knowTitle: "Know what's selling",
    knowBody: "Revenue, visits and your best products, without a spreadsheet.",
  },

  /**
   * Words that belong to a *control* rather than to a screen.
   *
   * `@sailo/design-native` deliberately holds no dictionary — it is consumed by
   * one app and threading a locale into it would make every primitive take a
   * translation prop — so the two or three strings its controls cannot invent
   * are passed in from here. `TextField`'s show/hide button is the only one on
   * these screens.
   */
  field: {
    showPassword: "Show password",
    hidePassword: "Hide password",
  },

  /**
   * Where the seller is in the run of screens between an install and a shop.
   *
   * `{step}` and `{total}` rather than a baked "of", because "2 of 4" is not
   * the word order every language uses and several put the total first.
   */
  journey: {
    step: "Step {step} of {total}",
  },

  signIn: {
    title: "Sign in",
    subtitle: "Welcome back.",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    /*
     * Our own sentence for a 401, never the server's. `/sign-in/email` answers
     * the same 401 for a wrong password and for a staff address that may not
     * hold one, and that cover only holds while the app declines to decorate
     * it — see the note above `classify`.
     */
    rejected: "That email and password don't match an account.",
    /*
     * The throttle rule, in one string. It says what happened and what to do,
     * and it deliberately does not say the password was wrong — the server
     * never looked.
     */
    throttled: "Too many tries just now. Wait a minute and try again.",
    failed: "Couldn't sign you in.",
    noAccount: "New to Sailo?",
    createAccount: "Create an account",
  },

  /**
   * The empty region A14 fills with Apple and Google. Labelled now so the
   * screen is already laid out for two buttons rather than being redesigned
   * around them later.
   */
  social: {
    divider: "or",
    pending: "Signing in with Apple and Google is coming shortly.",
  },

  twoFactor: {
    title: "Two-factor verification",
    body: "Enter the six-digit code from your authenticator app.",
    code: "Six-digit code",
    submit: "Verify",
    submitting: "Checking…",
    useBackup: "Use a backup code instead",
    useApp: "Use my authenticator app instead",
    backupTitle: "Backup code",
    backupBody: "One of the codes you saved when you turned two-factor on. Each one works once.",
    backupCode: "Backup code",
    rejected: "That code isn't right. Codes change every 30 seconds — try the current one.",
    /*
     * The two-factor limiter is the one `apps/web/src/lib/auth.ts` documents
     * most carefully, and this is that sentence for the seller: it did not
     * check, so it is not telling them the code was wrong.
     */
    throttled: "Too many attempts. Wait a few minutes, then try again.",
    failed: "Couldn't check that code.",
  },

  signUp: {
    title: "Create your account",
    subtitle: "Takes about a minute.",
    name: "Your name",
    email: "Email",
    password: "Password",
    /** States the server's minimum rather than letting the seller find it. */
    passwordHint: "At least {min} characters.",
    passwordTooShort: "Use at least {min} characters.",
    submit: "Create account",
    submitting: "Creating your account…",
    conflict: "That email already has an account.",
    conflictAction: "Sign in instead",
    throttled: "Too many sign-ups from this connection just now. Try again in a few minutes.",
    failed: "Couldn't create your account.",
    haveAccount: "Already have an account?",
    signIn: "Sign in",
  },

  verifyEmail: {
    title: "Check your email",
    /** `{email}` — the address it actually went to, so a typo is visible. */
    body: "We sent a confirmation link to {email}. Click it when you get a moment.",
    /*
     * The whole point of this screen: it nags, it does not gate.
     * `requireEmailVerification` is false on the server and the app mirrors it.
     */
    notBlocking: "You don't have to wait — your account is already active.",
    resend: "Send it again",
    resending: "Sending…",
    resent: "Sent. Check your inbox, and your spam folder.",
    /** `{seconds}` — the cooldown, stated rather than left as a dead button. */
    cooldown: "You can send another in {seconds}s.",
    throttled: "That's a few in a row. Wait a few minutes before sending another.",
    failed: "Couldn't send it again.",
    continue: "Continue to the app",

    /*
     * ─────────────────────────────────────────────────────────────────────
     * THESE FIVE KEYS ARE TEMPORARY. DELETE THEM WHEN A02 LANDS.
     * ─────────────────────────────────────────────────────────────────────
     *
     * Claiming a handle and creating a shop are the two steps between an
     * account and a shop that can take an order, and neither exists: they need
     * `shop.checkHandle` and `shop.create`, which A02's work order promises and
     * `packages/api/src/routers/shop.ts` does not contain — it has `get` and
     * nothing else.
     *
     * So the screen says so. A new seller who signs up and is handed a tab bar
     * where every request answers UNAUTHORIZED has been told their shop is
     * broken; a seller told which two steps are not built yet has been told the
     * truth. This is the same rule as every other bound in this codebase — a
     * limit that does not admit itself reads as a failure.
     *
     * They are deliberately staged here rather than in the dictionaries, so
     * nothing that is about to be deleted is ever handed to thirty-four
     * translators. When A02 lands, these five go and the two rows become the
     * two screens.
     */
    nextTitle: "What's next",
    nextBody: "Two more steps and your shop can take its first order.",
    stepHandle: "Claim your shop's link",
    stepShop: "Create your shop",
    stepsUnavailable:
      "These two aren't in the app yet — they're what's being built next. Your account itself is ready, and nothing here needs doing again.",
  },

  getPaid: {
    title: "Get paid by card",
    body: "Connect Stripe so buyers can pay by card. It takes a few minutes and you can do it later.",
    connect: "Connect Stripe",
    connecting: "Opening Stripe…",
    /** Stripe said the link was stale and we are fetching another. */
    reopening: "Getting you a fresh link…",
    skip: "I'll do this later",
    /** The seller closed the sheet themselves. Not an error, and not a failure. */
    cancelled: "Nothing was set up. You can come back to this any time.",
    /** `connectLink` refuses below the Business plan — a 403 does not retry. */
    forbidden: "Card payments are part of the Business plan.",
    failed: "Couldn't open Stripe.",
    done: "Stripe is connected.",
  },
} satisfies Record<string, Record<string, string>>;

/** The shape `a.auth` will have once this moves. Screens type against it. */
export type AuthCopy = typeof AUTH_COPY;

/**
 * How many screens there are between "create an account" and a shop that can
 * take an order.
 *
 * Four: the account form, the email confirmation, the payout connection, and
 * the app itself. Two-factor is deliberately not counted — it only appears for
 * a seller who has already turned it on, which is to say never during sign-up,
 * and a progress indicator whose total changes depending on your settings is
 * worse than none.
 *
 * Here rather than in the screens because three of them draw the same dots and
 * a fourth is coming; a count copied into each is a count that will be `3` in
 * one file the first time a step is added.
 */
export const JOURNEY_STEPS = 4;

/**
 * "Step 2 of 4", in the seller's language.
 *
 * `StepDots` requires this rather than composing it, because the dots are pure
 * geometry — there is no text in them for a screen reader to find — and because
 * the sentence's word order is not the same in every language. `index` counts
 * from zero, like the component's; the string counts from one, like a person.
 */
export function journeyLabel(copy: AuthCopy, index: number): string {
  return interpolate(copy.journey.step, {
    step: index + 1,
    total: JOURNEY_STEPS,
  });
}

/**
 * How every screen in `(auth)/` reads a word.
 *
 * One function, so the lift described above is one edit rather than nine.
 *
 * `useT()` is called even though nothing here reads its dictionary yet, and it
 * is not decoration. It is what starts locale resolution — and locale
 * resolution is what sets the layout direction. These are the first screens a
 * seller ever sees, so if the auth flow does not start it, an Arabic handset
 * renders the whole of sign-up left-to-right and only flips once the tabs
 * mount. Calling it here also means these screens are already subscribed, so
 * they re-render on their own the moment this returns a real dictionary.
 */
export function useAuthCopy(): AuthCopy {
  useT();
  return AUTH_COPY;
}
