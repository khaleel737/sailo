import { interpolate } from "@sailo/i18n/native";
import { useT } from "./i18n";

/**
 * Every string the nine auth screens show, staged for the dictionaries.
 *
 * WHY IT IS NOT IN `lib/auth.ts` ANY MORE
 *
 * That file makes network calls, classifies refusals and holds the 2FA
 * challenge; this one holds 240 lines of English. Two subjects in one module,
 * and the split makes the change this block is *waiting for* a one-file edit:
 * lifting it into `@sailo/i18n`'s `admin/en.ts` under `auth:` turns the body of
 * `useAuthCopy()` into `return useT().a.auth`, and the other thirty-four
 * dictionaries then fail to compile until they are translated — which is the
 * mechanism working, not a regression.
 *
 * WHY IT IS NOT BESIDE THE SCREENS
 *
 * Expo Router turns every `.ts` and `.tsx` under `app/` into a route. A
 * `strings.ts` in `app/(auth)/` would be a route with no default export,
 * warning on every dev boot and landing in the typed-`href` union as something
 * linkable. `lib/` is a sibling of `app/`, so the router never reads it.
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
   * `@sailo/design-system` deliberately holds no dictionary — it is consumed by
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
