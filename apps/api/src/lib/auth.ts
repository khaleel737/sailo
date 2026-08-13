import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { getDb } from "@sailo/db";
import { account, session, user } from "@sailo/db/schema";

/**
 * A better-auth instance that can only ever say *no*.
 *
 * ─── DO NOT "COMPLETE" THIS FILE ───────────────────────────────────────────
 * This instance verifies sessions. It does not create them, and it must never
 * be able to. There is no `emailAndPassword`, no `emailVerification`, no
 * `magicLink`, no `twoFactor`, no `nextCookies` — and none of them are missing
 * by oversight. Adding any one of them turns this app into a second place
 * that mints credentials, which is exactly the thing this split exists to
 * prevent: two sign-in surfaces means two sets of rate limits, two staff
 * refusals, two 2FA gates, and the day they drift is the day the weaker one
 * becomes the way in.
 *
 * Sign-in lives in apps/web (`apps/web/src/lib/auth.ts`) and stays there. That
 * instance owns the rate limiting, the staff-address refusal, the 2FA
 * throttle, the geo capture and the mail. It is the only thing on this
 * database that writes a session row.
 *
 * If you need a new auth *behaviour*, add it there. If you need this app to
 * recognise something new about a caller, read it off the session it already
 * resolves.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * WHY IT WORKS AT ALL
 * A session here is a row in the shared `session` table plus a token signed
 * with `BETTER_AUTH_SECRET`. Verification needs both, and needs nothing else:
 * the same secret (read from the environment by better-auth's own default, so
 * the two apps cannot be configured apart), the same tables, and the two
 * plugins that decide *where* the token is read from.
 *
 * `bearer()` reads `Authorization: Bearer <token>`, checks its HMAC against
 * the secret and hands it to the session lookup as if it had arrived in a
 * cookie. `expo()` covers the mobile client's deep-link scheme. Both are
 * read-side only — neither can issue anything.
 *
 * `verification` is deliberately absent from the schema map below. Nothing
 * here mints or consumes a one-time token, so wiring the table would only
 * make it possible to.
 *
 * WHY THIS IS A FUNCTION AND NOT A CONST
 * `betterAuth()` resolves its adapter as soon as it is called, and the
 * drizzle adapter wants a live `getDb()` — which throws when `DATABASE_URL`
 * is unset. At module scope that turns `next build` into something that needs
 * a database to *compile*: Next imports every route module while collecting
 * page data, and the import alone was enough to fail the build. `packages/db`
 * is lazy for exactly this reason ("so `next build` doesn't need a live
 * connection string"); this keeps that true one level up. Memoised, so the
 * instance is still built once per process rather than once per request.
 */
let instance: ReturnType<typeof createAuth> | null = null;

/** The verify-only auth instance, built on first use. */
export function getAuth() {
  if (!instance) instance = createAuth();
  return instance;
}

function createAuth() {
  return betterAuth({
    /*
     * Matches apps/web. Not cosmetic: `appName` feeds cookie naming, so the
     * two instances must agree or this one looks for a cookie the other never
     * set.
     */
    appName: "Sailo",
    /*
     * The mobile app's scheme, same as apps/web declares. A native app has no
     * web origin, and better-auth refuses an unknown one.
     */
    trustedOrigins: ["sailo://"],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user, session, account },
    }),
    /*
     * Read-only, stated twice over.
     *
     * `disableSessionRefresh` is the one that has teeth: without it
     * better-auth rewrites `expiresAt` on any session older than `updateAge`,
     * so a plain `getSession` from this app would issue a write against a
     * table it has no business writing to — and would silently extend a
     * session that apps/web believes is counting down. `expiresIn` mirrors
     * apps/web's 30 days so the two agree on when a token is stale, even
     * though only web acts on it.
     */
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      disableSessionRefresh: true,
    },
    plugins: [bearer(), expo()],
  });
}
