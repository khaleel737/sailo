import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { getDb } from "@sailo/db";
import { account, session, user, verification } from "@sailo/db/schema";
import { sendHqSignInLink } from "@sailo/email/system";
import { lookupStaff } from "@sailo/security/roster";
import { rateLimit } from "@sailo/rate-limit";

/**
 * The staff door, and the only thing behind it.
 *
 * ─── WHAT THIS INSTANCE CAN DO, AND WHAT IT MUST NEVER LEARN ───────────────
 * One credential: a link mailed to an address on the roster. There is no
 * `emailAndPassword`, no `emailVerification`, no `twoFactor`, no `bearer`, no
 * `expo` — and none of them are missing by oversight.
 *
 *   - No password, because a staff account that holds one can be phished,
 *     guessed, or found in someone else's breach. There is nothing to steal
 *     here but an inbox we already have to trust.
 *   - No 2FA, and this is the honest consequence of the line above rather than
 *     a gap: enrolling in TOTP requires a password to confirm, so an account
 *     that has never had one cannot enrol. The second factor is the mailbox.
 *     If that trade ever stops being acceptable — and at some headcount it
 *     will — the answer is a WebAuthn passkey plugin here, not passwords.
 *   - No bearer or expo. Those exist so the phone can carry a session, and the
 *     phone talks to apps/api. Nothing native signs in to this panel.
 *
 * ─── WHY THIS IS NOT THE SECOND DOOR THE API APP WARNS ABOUT ───────────────
 * `apps/api/src/lib/auth.ts` says, at length, that sign-in lives in apps/web
 * and that a second credential-minting surface is exactly what its split
 * exists to prevent. That warning is intact and this does not violate it,
 * because the magic link did not get *copied* here — it was *moved*.
 *
 * In apps/web, `sendMagicLink` refused every address that was not staff. The
 * plugin was in the seller app but it only ever served this panel: no seller
 * could be sent a link, by construction. So the two doors are disjoint rather
 * than duplicated —
 *
 *     apps/web    sellers    password + 2FA + email verification
 *     apps/hq  staff      magic link, and nothing else
 *
 * — and there is no drift risk between them, because they share no mechanism
 * to drift on. apps/web keeps its `refusesPasswordAuth` hook so a staff
 * address still cannot grow a password on the seller door.
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * How long a sign-in link stays good. Short on purpose: the link *is* the
 * credential, so a live one sitting in an inbox is a live key. Five minutes
 * covers "open your mail and click".
 */
const MAGIC_LINK_TTL_SECONDS = 60 * 5;

/**
 * Seven days, where a seller gets thirty.
 *
 * Deliberately shorter, and the split is what makes it possible to say so:
 * while this panel lived inside apps/web it shared one session config with
 * every storefront customer, and shortening it would have signed sellers out
 * every week for a rule that was only ever about staff.
 *
 * The asymmetry is the point. A seller's stale session opens their own shop; a
 * staff session opens every seller's revenue and every buyer's personal data.
 * Seven days is roughly "you re-authenticate after a holiday", which costs one
 * click of a link that arrives instantly.
 *
 * There is deliberately no `cookieCache` here, for the same reason apps/web has
 * none: a signed cookie snapshot keeps a revoked session alive for its TTL, and
 * `revokeStaff` promises that ending someone's access ends it *now*.
 */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * WHY THIS IS A FUNCTION AND NOT A CONST
 *
 * `betterAuth()` resolves its adapter as soon as it is called, and the drizzle
 * adapter wants a live `getDb()` — which throws when `DATABASE_URL` is unset.
 * At module scope that turns `next build` into something that needs a database
 * to *compile*: Next imports every route module while collecting page data, and
 * the import alone is enough to fail the build. It did, on the first build of
 * this app, exactly as `apps/api/src/lib/auth.ts` warns.
 *
 * `packages/db` is lazy for this reason; this keeps that true one level up.
 * Memoised, so the instance is still built once per process rather than once
 * per request.
 */
let instance: ReturnType<typeof createAuth> | null = null;

/** The staff auth instance, built on first use. */
export function getAuth() {
  if (!instance) instance = createAuth();
  return instance;
}

function createAuth() {
  return betterAuth({
    /*
     * Matches apps/web and apps/api. `appName` feeds cookie naming, and while
     * this app is on its own origin — so its cookie is host-only and cannot be
     * confused with the seller one — keeping the three aligned means a session
     * row looks the same wherever it is read.
     */
    appName: "Sailo",
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      /*
       * `verification` is here, unlike apps/api, because this app genuinely does
       * consume a one-time token: that is what a magic link is. `twoFactor` is
       * absent because nothing here can enrol.
       */
      schema: { user, session, account, verification },
    }),
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 60 * 60 * 24,
      /*
       * Where each sign-in came from, shown in the panel's own security page.
       * Declared so the adapter knows the columns; written by the hook below.
       * `input: false` — a caller never supplies their own location.
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
             * one moment they can truthfully describe a session is its creation.
             * Local dev keeps null and the UI shows "—" rather than a guess.
             *
             * This matters more here than it does for sellers: a staff sign-in
             * from a country nobody on the roster lives in is the single
             * cheapest signal that something is wrong.
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
     * per-instance: a limit of eight is eight *per warm function*. Redis is
     * already here for the app's own limits, and `consume` is better-auth's
     * atomic path — implementing it means the library skips its read-then-write
     * fallback, which it warns is best-effort under concurrency.
     *
     * Fails open when Redis is missing or cold, like every other limit in this
     * repo. A limiter that locks staff out because its own backend is down has
     * done more damage than the traffic it was meant to stop.
     */
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        /*
         * The only endpoint that sends mail, and the only one worth a tight rule.
         *
         * Only rostered addresses are ever mailed, but the endpoint answers
         * identically either way — which is what stops it being a test for who
         * is on the roster, and also what makes it free to hammer. Eight per
         * fifteen minutes: a real person asks for one link, maybe two when the
         * first is slow.
         */
        "/sign-in/magic-link": { window: 900, max: 8 },
      },
      customStorage: {
        consume: async (key, rule) => {
          /*
           * DECISION B — the magic-link endpoint keeps its ceiling when Redis is
           * cold; everything else here stays open.
           *
           * It is the one endpoint that sends mail, and it answers identically
           * whether or not the address is on the roster — which is what stops it
           * being a test for who is staff, and also what makes it free to hammer.
           * Unmetered it is an open relay on Sailo's own sending domain, aimed at
           * whatever address the caller types.
           *
           * The key is `<ip>|<path>` (`createRateLimitKey`), so the pipe is what
           * makes this match exact against an IPv6 address.
           */
          const closed = key.endsWith("|/sign-in/magic-link");
          const verdict = await rateLimit(`hq-auth:${key}`, rule.max, rule.window, {
            onOutage: closed ? "closed" : "open",
          });
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
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        sendMagicLink: async ({ email, url }) => {
          /*
           * The roster check, and it is the whole access control at this door.
           *
           * `lookupStaff` reads `staff_members` and falls back to the break-glass
           * env list only when that table has nothing to say about the address —
           * so a revoked member is refused here, not merely refused later. That
           * ordering is the difference between revocation and a suggestion.
           *
           * An address that fails gets a silent no: no error, no email, and
           * therefore no account and no session. The *caller* sees success
           * either way, because a response that differed would turn this
           * endpoint into an oracle for who works here. The refusal is logged
           * server-side, where it is useful to us and invisible to them.
           *
           * Sign-up through the link is left on deliberately. Only rostered
           * addresses ever receive one, and better-auth creates the account at
           * the moment the link is clicked — inbox proven, `emailVerified` set,
           * and no password anywhere for anyone to phish or reuse. This is what
           * makes "invite someone who has never signed in" work at all.
           */
          const member = await lookupStaff(email);
          if (!member) {
            console.warn(`[sailo] hq magic link refused for ${email}`);
            return;
          }

          const result = await sendHqSignInLink({
            to: member.email,
            url,
            expiresInMinutes: MAGIC_LINK_TTL_SECONDS / 60,
          });
          if (!result.sent) {
            /*
             * Better-auth answers the request the same either way, so a failure
             * here is otherwise invisible: the person waits for mail that never
             * comes and has nothing to report but "it didn't arrive".
             */
            console.warn(`[sailo] hq magic link email not sent: ${result.reason}`);
          }
        },
      }),
      // Must stay last so Server Actions can set cookies.
      nextCookies(),
    ],
    });
}
