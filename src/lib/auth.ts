import { betterAuth } from "better-auth";
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
import { isStaffEmail } from "@/lib/staff";

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
     * signed up before verification existed. What unverified addresses can
     * never do is open /hq: `requireStaff` insists on a verified email, so
     * typing a staff address into the sign-up form proves nothing.
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
