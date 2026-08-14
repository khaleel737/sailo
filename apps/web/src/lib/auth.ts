import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { deleteSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { bearer, magicLink, twoFactor } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { getDb } from "@sailo/db";
import { account, session, twoFactor as twoFactorTable, user, verification } from "@sailo/db/schema";
import { appUrl } from "@/lib/app-url";
import {
  sendEmailConfirmation,
  sendHqSignInLink,
  sendPasswordReset,
} from "@/lib/email";
import {
  appleClientSecret,
  appleDisplayName,
  isSocialSessionPath,
  socialPathAnswersJson,
} from "@/lib/social-auth";
import { isStaffEmail, refusesPasswordAuth } from "@/lib/staff";
import { rateLimit, refundRateLimit } from "@sailo/rate-limit";

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

/**
 * Better-auth's own refusals, copied rather than imported.
 *
 * They live in `@better-auth/core/error`, which is a nested dependency of
 * `better-auth` rather than a package this app declares — importing it would
 * be reaching through someone else's `node_modules` for two strings. Copied
 * with the source named instead, and `auth.test.ts` asserts they still match
 * what the library throws, so a reword upstream fails a test rather than
 * silently making our refusal distinguishable again.
 */
export const BETTER_AUTH_MESSAGES = {
  /** `/sign-up/email`, 422, when the address is taken. */
  userExists: "User already exists. Use another email.",
  /** `/sign-in/email`, 401, when the password is wrong. */
  badCredentials: "Invalid email or password",
} as const;

/**
 * The two-factor verify endpoints, and the shape of the limit on them.
 *
 * Keyed on the *user*, not the caller's address: the threat this rations is
 * someone who already holds the password and is guessing the six digits, and
 * they can rotate IPs far more easily than the account can rotate users. Five
 * per fifteen minutes — a real person mistypes once or twice; a guesser needs
 * thousands.
 */
const TWO_FACTOR_VERIFY_PATHS = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);
const TWO_FACTOR_ATTEMPTS = 5;
const TWO_FACTOR_WINDOW_SECONDS = 15 * 60;

const twoFactorRateKey = (userId: string) => `2fa:${userId}`;

/** What `hooks.before` and `hooks.after` are handed. */
type AuthHookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * Whose codes are being guessed. Mid-sign-in there is no session — the
 * challenge cookie stands in for one, and its signed value resolves to the
 * pending user id through the verification table, the same lookup the plugin
 * itself makes (`verify-two-factor.mjs`). Read-only on purpose: consuming the
 * verification value here would break the endpoint this runs in front of.
 */
async function twoFactorUserId(ctx: AuthHookContext): Promise<string | null> {
  const signedIn = await getSessionFromCtx(ctx);
  if (signedIn?.user) return signedIn.user.id;

  // "two_factor" is the plugin's cookie name; `createAuthCookie` adds the
  // same prefixes the plugin's own cookie carries.
  const cookie = ctx.context.createAuthCookie("two_factor");
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) return null;

  const pending =
    await ctx.context.internalAdapter.findVerificationValue(identifier);
  return pending?.value ?? null;
}

/* -------------------------------------------------------------------------
 * Apple and Google
 * ---------------------------------------------------------------------- */

/**
 * Google's provider, or nothing at all.
 *
 * Absent credentials mean the provider is not registered, so `/sign-in/social`
 * answers `PROVIDER_NOT_FOUND` rather than registering a client that fails at
 * the first redirect. A preview deployment with no Google console behind it
 * says "we don't do that here", which is true, instead of "something went
 * wrong", which is not.
 */
function googleSignIn() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

/**
 * Apple's provider, or nothing at all.
 *
 * Two things here have no counterpart in any other provider:
 *
 * **The client secret is minted, not configured.** Apple issues a `.p8`
 * signing key and expects the secret to be an ES256 JWT signed with it, capped
 * at six months. `appleClientSecret` mints a fresh one on every module
 * evaluation, which is what stops this integration from failing on a Tuesday
 * six months after launch with `invalid_client` and nothing in the diff to
 * explain it. See `docs/auth/apple-sign-in.md`.
 *
 * **The Services ID and the bundle identifier are different strings.** The
 * browser flow authenticates as the Services ID (`store.sailo.signin`); a
 * device-issued identity token is audienced to the bundle identifier
 * (`store.sailo.app`). Crossing them is the most common way an Apple setup
 * fails, and it fails as a generic refusal from Apple, so equality is refused
 * here where the cause is still visible.
 */
function appleSignIn() {
  const clientId = process.env.APPLE_CLIENT_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKey = process.env.APPLE_PRIVATE_KEY;
  const appBundleIdentifier = process.env.APPLE_APP_BUNDLE_IDENTIFIER;

  if (!clientId || !teamId || !keyId || !privateKey) return undefined;

  if (appBundleIdentifier && clientId === appBundleIdentifier) {
    console.error(
      "[sailo] APPLE_CLIENT_ID must be the Services ID, not the bundle identifier — Apple sign-in is off",
    );
    return undefined;
  }

  let clientSecret: string;
  try {
    clientSecret = appleClientSecret({
      clientId,
      teamId,
      keyId,
      privateKey,
      now: Date.now(),
    });
  } catch (error) {
    /*
     * An unreadable `.p8` must not take the site down. Everything else about
     * this deployment still works — password sign-in, the admin, checkout —
     * and a boot crash over one optional provider would trade a missing button
     * for an outage.
     */
    console.error("[sailo] Apple sign-in is off: the private key would not sign", error);
    return undefined;
  }

  return {
    clientId,
    clientSecret,
    appBundleIdentifier,
    /*
     * **Apple sends the name once, on the first authorisation, and never
     * again.** `user.name` is `notNull`, and better-auth's Apple provider
     * falls back to `""` when the name is absent — which is every callback
     * after the first, and every callback at all if the seller signed in on a
     * device that had already authorised the app. See `appleDisplayName`.
     */
    mapProfileToUser: (profile: {
      name?: unknown;
      email?: unknown;
      is_private_email?: unknown;
    }) => ({ name: appleDisplayName(profile) }),
  };
}

/* -------------------------------------------------------------------------
 * What happens after a provider hands back a session
 * ---------------------------------------------------------------------- */

/**
 * The challenge cookie's name and life, copied from the two-factor plugin.
 *
 * Copied rather than imported for the same reason `BETTER_AUTH_MESSAGES` is:
 * both live in the plugin's internals rather than its public surface. The
 * guard below writes a challenge that `verifyTwoFactor` then reads, so the two
 * have to agree on the cookie name, on the identifier that keys the
 * verification row, and on the `2fa-attempts-` prefix of its attempt counter.
 * `auth-social.test.ts` reads all three back out of the library, so a rename
 * upstream fails a test rather than silently producing a challenge that no
 * endpoint can answer.
 */
const TWO_FACTOR_COOKIE = "two_factor";
const TWO_FACTOR_CHALLENGE_SECONDS = 600;

/** Ends the session a provider callback just created, cookie and row. */
async function endSession(ctx: AuthHookContext, token: string): Promise<void> {
  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(token);
  // Downstream hooks must not observe a session that no longer exists — the
  // expo plugin's callback hook reads the response's cookies straight after.
  ctx.context.setNewSession(null);
}

/**
 * Puts a seller in front of the second factor, exactly as a password sign-in
 * would have.
 *
 * The pair of verification rows is not optional: `verifyTwoFactor` consumes
 * `2fa-attempts-<identifier>` before it will look at a code, and treats its
 * absence as an invalid challenge. A cookie without its counter is a challenge
 * that can never be answered.
 */
async function challengeForTwoFactor(
  ctx: AuthHookContext,
  userId: string,
): Promise<void> {
  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE, {
    maxAge: TWO_FACTOR_CHALLENGE_SECONDS,
  });
  const identifier = `2fa-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_SECONDS * 1000);

  await ctx.context.internalAdapter.createVerificationValue({
    value: userId,
    identifier,
    expiresAt,
  });
  await ctx.context.internalAdapter.createVerificationValue({
    value: "0",
    identifier: `2fa-attempts-${identifier}`,
    expiresAt,
  });
  await ctx.setSignedCookie(
    cookie.name,
    identifier,
    ctx.context.secret,
    cookie.attributes,
  );
}

/**
 * The two things a provider callback must not be allowed to do.
 *
 * **This runs because the two-factor plugin does not.** Its own hook matches
 * `/sign-in/email`, `/sign-in/username` and `/sign-in/phone-number` and
 * nothing else, so without this a seller who has enrolled in two-factor auth
 * could sign in with Google and skip the second factor entirely — the strongest
 * account on the platform reduced to whatever their Google password is. That is
 * a regression the buttons would have shipped silently, since every existing
 * test covers the password path.
 *
 * **And a staff address may not hold a provider either.** `staff.ts` says a
 * roster account signs in by magic link and holds "no password anywhere for
 * anyone to phish or reuse"; a linked Google account is exactly such a
 * credential, and it widens /hq's door to whoever can reach that Google
 * account. The `hooks.before` refusal above cannot cover this — it matches on
 * the address in the request body, and a provider callback carries no address
 * at all until the token comes back.
 *
 * The refusal here is deliberately *not* indistinguishable, unlike the
 * password one. That doctrine exists because `/sign-up/email` will take any
 * address anyone types, which makes a distinctive answer an enumeration
 * oracle. Reaching this point instead costs a completed authorisation at Apple
 * or Google **as the address in question**, so the only person who can see this
 * refusal is someone who already holds the mailbox — the same bar the magic
 * link itself sets. Saying where to sign in is more useful than hiding it.
 *
 * Note both branches run *after* the row is written: better-auth creates or
 * links the account before any hook sees the result. So the session is torn
 * down and the provider row deleted, rather than prevented — the outcome is
 * the same, and it is the only place in the request where the verified address
 * is known.
 */
async function guardSocialSignIn(ctx: AuthHookContext) {
  const created = ctx.context.newSession;
  // No session means no sign-in to guard: `/sign-in/social` without an
  // identity token only hands back an authorize URL, and a failed callback
  // has already redirected to the error page.
  if (!created) return;

  if (isStaffEmail(created.user.email)) {
    console.warn(`[sailo] social sign-in refused for staff address on ${ctx.path}`);
    await endSession(ctx, created.session.token);

    for (const row of await ctx.context.internalAdapter.findAccounts(
      created.user.id,
    )) {
      if (row.providerId === "apple" || row.providerId === "google") {
        await ctx.context.internalAdapter.deleteAccount(row.id);
      }
    }

    if (socialPathAnswersJson(ctx.path)) {
      throw new APIError("UNAUTHORIZED", {
        message: "This account signs in with a link, not with a provider.",
      });
    }
    throw ctx.redirect(`${appUrl()}/hq/login`);
  }

  const enrolled = Boolean(
    (created.user as { twoFactorEnabled?: boolean }).twoFactorEnabled,
  );
  if (!enrolled) return;

  await endSession(ctx, created.session.token);
  await challengeForTwoFactor(ctx, created.user.id);

  if (socialPathAnswersJson(ctx.path)) {
    /*
     * The same body the password path answers with, so a client that already
     * handles `twoFactorRedirect` needs no second branch. `twoFactorMethods`
     * is `["totp"]` rather than computed: enrolment only ever flips
     * `twoFactorEnabled` after a code has verified the secret
     * (`actions/security.ts`), and no `sendOTP` is configured, so there is
     * exactly one method a seller can be holding here.
     */
    return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
  }

  /*
   * The browser gets the page the password path sends it to. `/verify-2fa`
   * needs nothing but the challenge cookie just written — it reads no session
   * and takes no parameters — so the existing screen finishes this sign-in
   * unchanged.
   *
   * NATIVE, stated rather than assumed: this is a web URL, so a phone that
   * walked the browser flow finishes two-factor in the browser and does not
   * return to the app. A14 owns that leg and must handle it; the id-token
   * path above, which is what the native app should use, answers in JSON and
   * has no such gap.
   */
  throw ctx.redirect(`${appUrl()}/verify-2fa`);
}

/*
 * Resolved once, at module scope. Apple's half signs a JWT, so calling it per
 * request would mint a secret per request for no benefit.
 */
const google = googleSignIn();
const apple = appleSignIn();

export const auth = betterAuth({
  /*
   * Doubles as the TOTP issuer — the name a seller sees beside the rotating
   * code in their authenticator app. Renaming it after launch would strand
   * every existing enrolment under the old label, so don't.
   */
  appName: "Sailo",
  /*
   * The mobile app signs in against this same server, and its deep-link scheme
   * is not a web origin — better-auth rejects an unknown one, so `sailo://` is
   * named here for the OAuth/magic-link return leg to be allowed back into the
   * app. Web origins keep coming from the request host as before.
   */
  trustedOrigins: ["sailo://"],
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: { user, session, account, verification, twoFactor: twoFactorTable },
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
  /*
   * Apple and Google, and deliberately nothing else.
   *
   * Both **verify the email address they hand back**, which is what makes the
   * linking policy below a single rule instead of two: there is no untrusted
   * provider to branch on, and no takeover vector to reason about. Both also
   * always return an address, so there is no emailless account to design
   * around. Either provider is registered only when its credentials are
   * configured — see `googleSignIn` and `appleSignIn`.
   *
   * **A provider that does not verify email may not be added to this list.**
   * Doing so would make `trustedProviders` below a lie: it would let a caller
   * who merely claims an address be linked into the account that already owns
   * it. If one is ever wanted, the linking policy has to be reopened first and
   * that provider kept out of `trustedProviders`.
   */
  socialProviders: {
    ...(google ? { google } : {}),
    ...(apple ? { apple } : {}),
  },
  /*
   * THE COLLISION POLICY, decided rather than inherited.
   *
   * A seller signed up with a password months ago. Today they click "Continue
   * with Google" on the same address. The answer is **link the two**, giving
   * one account with two ways in — not a second account, and not a refusal.
   *
   * That is safe here *only* because of what these two providers are. Google
   * and Apple both assert that they verified the address, so the callback is
   * proof of ownership rather than a claim of it, and `trustedProviders` says
   * so explicitly. A provider that merely echoed back whatever address the
   * caller typed would, under this same setting, hand that caller the existing
   * account.
   *
   * The mirror-image attack is closed by better-auth's default and not by
   * anything written here, which is worth knowing before anyone turns it off:
   * `requireLocalEmailVerified` (default true) additionally demands that the
   * *local* row be verified before an implicit link. Without it, an attacker
   * who registers an unverified password account at a victim's address first
   * would have the victim's Google identity linked into the attacker's row on
   * the victim's very first sign-in.
   *
   * The cost of keeping it is real and should not surprise anyone reading a
   * support ticket: sign-up does not require verification (`emailAndPassword`
   * above), so a seller who never clicked the confirmation email will find
   * that "Continue with Google" refuses to link, with `account_not_linked`.
   * The way out already exists — the admin's confirmation banner and its
   * resend button — but the error itself does not say so.
   *
   * `allowDifferentEmails` and `allowUnlinkingAll` stay at their defaults
   * (both false). The second is what makes the linked-accounts card's promise
   * true on the server as well as in the UI: the last credential cannot be
   * unlinked, so no seller can lock themselves out from that screen.
   */
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["apple", "google"],
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
    /*
     * Where each sign-in came from, shown in Settings → Security. Declared so
     * the adapter knows the columns; written by the session hook below.
     * `input: false` — a caller never supplies their own location.
     *
     * Note there is deliberately no `cookieCache` here: the sessions table
     * promises that a terminated session fails *immediately*, and a signed
     * cookie snapshot would keep a revoked session alive for its TTL. Every
     * `getSession` pays the database read; that is the price of the promise.
     */
    additionalFields: {
      city: { type: "string", required: false, input: false },
      country: { type: "string", required: false, input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (_session, ctx) => {
          /*
           * Vercel's geo headers describe the *current request* only, so the
           * one moment they can truthfully describe a session is its
           * creation. Sessions from before this existed, and local dev, keep
           * null — the UI shows "—" rather than a guess.
           */
          const headers = ctx?.headers ?? ctx?.request?.headers;
          if (!headers) return;

          // Vercel percent-encodes header values ("S%C3%A3o%20Paulo").
          const geo = (name: string): string | null => {
            const raw = headers.get(name);
            if (!raw) return null;
            try {
              const decoded = decodeURIComponent(raw).trim();
              return decoded || null;
            } catch {
              return raw.trim() || null;
            }
          };

          const city = geo("x-vercel-ip-city");
          const country = geo("x-vercel-ip-country");
          if (!city && !country) return;
          return { data: { city, country } };
        },
      },
    },
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
    max: 60,
    /*
     * Sized against a shared IP, not against one person.
     *
     * The key is the caller's address, and an office, a university, a
     * coworking space and a mobile carrier's NAT are all one address. The
     * first version of this table allowed five signups per fifteen minutes,
     * which a browser test tripped within a minute of real use — and on launch
     * day that is not a blocked attacker, it is five colleagues signing up
     * together and the sixth being told to go away.
     *
     * So the numbers are set where a human never reaches them and an automated
     * attempt still does: bulk account creation needs hundreds, credential
     * stuffing needs thousands. What stays tight is anything that sends mail
     * to an address the *caller* chooses, because there the cost of a false
     * positive is one person waiting a minute and the cost of a false negative
     * is someone else's inbox flooded from our domain.
     */
    customRules: {
      "/sign-in/email": { window: 300, max: 25 },
      "/sign-up/email": { window: 900, max: 20 },
      "/reset-password": { window: 900, max: 20 },
      // Mail to a caller-chosen address. Deliberately the tightest rows here.
      "/send-verification-email": { window: 900, max: 8 },
      "/forget-password": { window: 900, max: 8 },
      // The staff door. Only rostered addresses are ever mailed, but the
      // endpoint answers identically either way, so it is free to hammer.
      "/sign-in/magic-link": { window: 900, max: 8 },
      /*
       * The provider round trip, both legs.
       *
       * Sized loosely on purpose. Nothing here guesses at a credential —
       * getting a useful answer out of either endpoint costs a completed
       * authorisation at Apple or Google — so what these ration is a flood,
       * not an attack, and the cost of a false positive is a seller on a
       * shared address being turned away from the one button they clicked.
       *
       * `/callback/*` is a wildcard because rate limiting keys on the real
       * request path (`/callback/google`), while the hooks above match on the
       * route pattern (`/callback/:id`). The two are not interchangeable and
       * a literal in either place would never fire.
       *
       * A throttled attempt answers 429, which is "ask again later" and never
       * "no" — the same rule the two-factor limit above follows.
       */
      "/sign-in/social": { window: 300, max: 25 },
      "/callback/*": { window: 300, max: 25 },
      // Linking from Settings → Security. Session-guarded already, so this is
      // only here to stop one signed-in seller from being a traffic source.
      "/link-social": { window: 300, max: 20 },
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
      /*
       * Attempts at a second factor are attempts at a secret, so they follow
       * the repo's charge-then-refund shape (`refundRateLimit`): every
       * attempt pays up front — `INCR` is atomic, so a concurrent burst
       * cannot peek past the ceiling — and the after-hook below refunds the
       * ones that turn out to be the legitimate user using their one code.
       *
       * A throttled attempt is *unknown*, not *wrong*: the refusal says "try
       * again later" and never "invalid code", because the throttle has not
       * looked at the code and must not pretend it has. The plugin's own
       * database-backed lockout (ten failures, fifteen minutes) stays on
       * underneath as the net for when Redis is cold — this limit fails open
       * like every other one here.
       */
      if (TWO_FACTOR_VERIFY_PATHS.has(ctx.path)) {
        const userId = await twoFactorUserId(ctx);
        // No resolvable user means no challenge and no session; the endpoint
        // is about to refuse the request itself, so there is nothing to meter.
        if (userId) {
          const verdict = await rateLimit(
            twoFactorRateKey(userId),
            TWO_FACTOR_ATTEMPTS,
            TWO_FACTOR_WINDOW_SECONDS,
          );
          if (!verdict.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many attempts. Try again later.",
            });
          }
        }
        return;
      }

      /*
       * Connecting a provider from Settings → Security is the same credential
       * by another name, so the roster rule covers it too.
       *
       * `guardSocialSignIn` already refuses the *sign-in*, which would make
       * this redundant — except that leaving the creation path open and
       * relying on a teardown two steps later is the "guard applied at one
       * sink and not its twin" shape this codebase keeps finding. Here the
       * address needs no provider round trip: the caller is signed in, so it
       * is already known.
       */
      if (ctx.path === "/link-social") {
        const signedIn = await getSessionFromCtx(ctx);
        if (isStaffEmail(signedIn?.user.email)) {
          console.warn("[sailo] social link refused for staff address");
          throw new APIError("FORBIDDEN", {
            message: "This account signs in with a link, not with a provider.",
          });
        }
        return;
      }

      if (!refusesPasswordAuth(ctx.path, ctx.body?.email)) return;

      console.warn(`[sailo] password auth refused for staff address on ${ctx.path}`);

      /*
       * Each endpoint's *own* refusal, status and message, rather than one of
       * our own.
       *
       * The first version threw a bespoke 400 saying "use a sign-in link",
       * with a comment claiming it was "the same one an ordinary duplicate
       * signup gets". It was not, and a review caught the difference: a
       * distinct status and a message naming the magic link turned the
       * endpoint into a test for whether an address is on the staff roster.
       * Anyone could have enumerated it from outside.
       *
       * `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` at 422 is exactly what
       * `/sign-up/email` answers for an address that is taken — which a staff
       * address, having been created by a magic link, genuinely is.
       * `INVALID_EMAIL_OR_PASSWORD` at 401 is exactly what `/sign-in/email`
       * answers for a wrong password. Both are true as well as
       * indistinguishable, which is the only kind of cover worth having.
       */
      if (ctx.path === "/sign-up/email") {
        throw new APIError("UNPROCESSABLE_ENTITY", {
          message: BETTER_AUTH_MESSAGES.userExists,
        });
      }
      throw new APIError("UNAUTHORIZED", {
        message: BETTER_AUTH_MESSAGES.badCredentials,
      });
    }),
    after: createAuthMiddleware(async (ctx) => {
      // A provider callback has its own two things to answer for — the second
      // factor the plugin's hook does not cover, and the staff roster. Both
      // need the session that was just created, so they run here.
      if (isSocialSessionPath(ctx.path)) return guardSocialSignIn(ctx);

      if (!TWO_FACTOR_VERIFY_PATHS.has(ctx.path)) return;

      /*
       * The refund half of the charge above. After-hooks run on failures too —
       * dispatch catches the endpoint's APIError and parks it in
       * `ctx.context.returned` — so the refund is gated on the outcome:
       * only a verified code gives its unit back. On the sign-in path the
       * challenge cookie has been consumed by now, so the user comes from the
       * response body the endpoint just built rather than from the cookie.
       */
      if (isAPIError(ctx.context.returned)) return;

      const returned = ctx.context.returned as { user?: { id?: string } } | undefined;
      const userId =
        returned?.user?.id ?? (await getSessionFromCtx(ctx))?.user.id ?? null;
      if (userId) {
        await refundRateLimit(twoFactorRateKey(userId), TWO_FACTOR_WINDOW_SECONDS);
      }
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
    /*
     * TOTP two-factor auth for seller accounts. Password sign-in for an
     * enrolled user answers `twoFactorRedirect` instead of a session and the
     * client steps through /verify-2fa; enabling, disabling and the seller UI
     * live in `lib/actions/security.ts`.
     *
     * MAGIC LINKS AND 2FA, decided rather than left implicit: a magic-link
     * sign-in bypasses the 2FA challenge — the plugin's after-hook matches
     * only the password sign-in paths — and that is acceptable *here* because
     * the two doors admit disjoint sets of people. `sendMagicLink` above
     * refuses every address off the staff roster, so no seller can be signed
     * in by link; and a staff account holds no password (enforced in the
     * `hooks.before` refusal), so it cannot pass the password check that
     * enabling 2FA requires and can never be enrolled. If magic links are
     * ever opened to sellers, that sign-in path must be gated for
     * 2FA-enabled users too — do not reuse it as-is. HQ staff sign-in is a
     * separate surface and out of scope for seller 2FA.
     *
     * Plugin defaults kept deliberately: verify-before-enable (the enrolment
     * secret stays `verified: false` until a code proves the authenticator
     * holds it — never flip the toggle on an unverified secret), ±1 time-step
     * TOTP drift with a constant-time comparison, encrypted secret and backup
     * codes, and a database-backed lockout of ten failed verifications per
     * fifteen minutes underneath the Redis limit in `hooks.before`.
     */
    twoFactor(),
    // Must stay last so Server Actions can set cookies.
    /*
     * The mobile app carries its session as a bearer token, not a cookie — a
     * native app has no cookie jar. `bearer()` lets the server read
     * `Authorization: Bearer <token>` and issue the token on sign-in; `expo()`
     * adds the deep-link handling the Expo client needs on the return leg.
     * Both sit before `nextCookies()`, which better-auth requires to stay last
     * so it can write the Set-Cookie for the web after everything else has run.
     */
    bearer(),
    expo(),
    nextCookies(),
  ],
});
