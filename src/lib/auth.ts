import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db";
import { account, session, user, verification } from "@/db/schema";
import { sendPasswordReset } from "@/lib/email";

/**
 * How long a reset link stays good. Set here rather than left to the default
 * so the email can state a number that can't drift away from the real one.
 */
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    // Sign-up stays instant. Mail is wired now, but making verification
    // mandatory would lock out everyone who signed up before it existed.
    requireEmailVerification: false,
    minPasswordLength: 8,
    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
    /*
     * A reset is how someone takes an account back, so it has to end every
     * session that still holds the old password — otherwise whoever prompted
     * the reset keeps the access the reset was meant to revoke.
     */
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user: account, url }) => {
      const result = await sendPasswordReset({
        to: account.email,
        name: account.name,
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
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,
  },
  // Must stay last so Server Actions can set cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
