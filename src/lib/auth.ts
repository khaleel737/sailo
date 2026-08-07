import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { getDb } from "@/db";
import { account, session, user, verification } from "@/db/schema";
import {
  sendEmailConfirmation,
  sendHqSignInLink,
  sendPasswordReset,
} from "@/lib/email";
import { isStaffEmail, refusesPasswordAuth } from "@/lib/staff";
import { rateLimit } from "@/lib/redis";

/**
 * How long a reset link stays good. Set here rather than left to the default
 * so the email can state a number that can't drift away from the real one.
 */
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * How long an /hq magic link stays good. Short on purpose: the whole point of
 * the link is that it is the staff sign-in, so a live one sitting in an inbox
 * is a live key. Five minutes covers "open your mail and click".
 */
const MAGIC_LINK_TTL_SECONDS = 60 * 5;

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    /*
     * Sign-up stays instant — a confirmation email goes out (below), and the
     * admin shows a banner until it's clicked, but a seller can set up their
     * shop while it waits. Making it blocking would lock out everyone who
     * signed up before verification existed.
     *
     * This used to add that typing a staff address into the sign-up form
     * "proves nothing", which was the wrong reassurance: it proved nothing
     * only until someone clicked the confirmation that signup mailed to the
     * real inbox. See the `hooks` block below, which is what makes the claim
     * true — a staff address cannot reach this endpoint at all.
     */
    requireEmailVerification: false,
    minPasswordLength: 8,
    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
    /*
     * A reset is how someone takes an account back, so it has to end every
     * session that still holds the old password — otherwise whoever prompted
     * the reset keeps the access the reset was meant to revoke.
     */
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user: recipient, url }) => {
      const result = await sendPasswordReset({
        to: recipient.email,
        name: recipient.name,
        url,
        expiresInHours: RESET_TOKEN_TTL_SECONDS / 3600,
      });
      if (!result.sent) {
        // Better-auth answers the request the same either way, so a failure
        // here is otherwise invisible: the seller waits for mail that never
        // comes and has nothing to report but "it didn't arrive".
        console.warn(`[sailo] password reset email not sent: ${result.reason}`);
      }
    },
  },
  emailVerification: {
    // The claim-check on a fresh address. Goes out with sign-up, and again on
    // demand from the admin banner's "resend" button.
    sendOnSignUp: true,
    // Clicking the link should land them signed in, not at a login form
    // wondering whether it worked.
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user: recipient, url }) => {
      const result = await sendEmailConfirmation({
        to: recipient.email,
        name: recipient.name,
        url,
      });
      if (!result.sent) {
        console.warn(`[sailo] confirmation email not sent: ${result.reason}`);
      }
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,
  },
  /*
   * Rate limiting that survives more than one instance.
   *
   * Better-auth's default storage is `memory`, which on Fluid Compute means
   * per-instance: a limit of five is five *per warm function*, and concurrency
   * decides how many of those exist. In practice that is no limit at all on
   * exactly the endpoints that most need one — password sign-in (credential
   * stuffing), sign-up, `/send-verification-email` and `/forget-password`,
   * each of which either guesses at a credential or sends mail to an address
   * the caller chose.
   *
   * Redis is already here for the app's own limits, and `consume` is
   * better-auth's atomic path: implementing it means the library skips its
   * read-then-write fallback, which it warns is best-effort under concurrency
   * — the same check-then-act gap this codebase has fixed three times
   * elsewhere.
   *
   * Fails open when Redis is missing or cold, like every other limit here. A
   * limiter that locks real sellers out because its own backend is down has
   * done more damage than the traffic it was meant to stop.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customRules: {
      // Guessing a password, and the two endpoints that send mail to an
      // address the caller names.
      "/sign-in/email": { window: 300, max: 8 },
      "/sign-up/email": { window: 900, max: 5 },
      "/send-verification-email": { window: 900, max: 4 },
      "/forget-password": { window: 900, max: 4 },
      "/reset-password": { window: 900, max: 8 },
      // The staff door. Only rostered addresses are ever mailed, but the
      // endpoint answers identically either way, so it is free to hammer.
      "/sign-in/magic-link": { window: 900, max: 5 },
    },
    customStorage: {
      consume: async (key, rule) => {
        const verdict = await rateLimit(`auth:${key}`, rule.max, rule.window);
        return {
          allowed: verdict.allowed,
          retryAfter: verdict.allowed ? null : rule.window,
        };
      },
      // Unused while `consume` is present; better-auth's storage contract
      // still requires them.
      get: async () => null,
      set: async () => {},
    },
  },
  /*
   * A staff address may not hold a password. This closes an account
   * pre-hijack, and it is the assumption in the comment above — "typing a
   * staff address into the sign-up form proves nothing" — being made true,
   * because on its own it was not.
   *
   * The chain it breaks: sign up as the roster address with a password of the
   * attacker's choosing. `sendOnSignUp` then mails the *real* inbox, from
   * Sailo's genuine sending domain, a message indistinguishable from the one a
   * colleague's own signup produces — and `/send-verification-email` is
   * unauthenticated, so it can be sent again as often as the attacker likes.
   * One click by anyone with inbox access sets `emailVerified`, and it does so
   * without touching the credential: better-auth's magic-link flow calls
   * `revokeUnprovenAccountAccess` before flipping that flag, and its
   * email-verification flow does not. The attacker then signs in with the
   * password they chose and `requireStaff` — verified address, on the roster —
   * lets them into /hq, which is every seller's revenue and every buyer's
   * personal data.
   *
   * `staff.ts` already says these accounts sign in by magic link and hold "no
   * password anywhere for anyone to phish or reuse". This is the sentence
   * enforced rather than described. Sign-in is refused as well as sign-up, so
   * a row created before today cannot be used either.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!refusesPasswordAuth(ctx.path, ctx.body?.email)) return;

      console.warn(`[sailo] password auth refused for staff address on ${ctx.path}`);
      /*
       * The same message either way, and the same one an ordinary duplicate
       * signup gets. Naming the roster here would turn the endpoint into a
       * test for whether an address is staff.
       */
      throw new APIError("BAD_REQUEST", {
        message: "This address can't be used with a password. Use a sign-in link.",
      });
    }),
  },
  plugins: [
    /*
     * The staff door. /hq/login asks for a link, this decides who gets one:
     * an address off the roster gets a silent no — not an error, because the
     * response must read identically from outside — and no email, which means
     * no account and no session. The check lives here, on the server, where
     * the client can't reach around it.
     *
     * Sign-up through the link is left on deliberately. Only rostered
     * addresses ever receive one, and better-auth creates the account at the
     * moment the link is clicked — inbox proven, `emailVerified` set, and no
     * password anywhere for anyone to phish or reuse.
     */
    magicLink({
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      sendMagicLink: async ({ email, url }) => {
        if (!isStaffEmail(email)) {
          // Server-side only, same as the /hq refusal: the caller sees success.
          console.warn(`[sailo] magic link refused for ${email}`);
          return;
        }
        const result = await sendHqSignInLink({
          to: email,
          url,
          expiresInMinutes: MAGIC_LINK_TTL_SECONDS / 60,
        });
        if (!result.sent) {
          console.warn(`[sailo] magic link email not sent: ${result.reason}`);
        }
      },
    }),
    // Must stay last so Server Actions can set cookies.
    nextCookies(),
  ],
});
