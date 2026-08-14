import { createSign } from "node:crypto";

/**
 * The parts of Apple and Google sign-in that can be reasoned about on their
 * own — minting Apple's client secret, deciding what to write into a
 * `notNull` name column, and naming the endpoints that hand out a session.
 *
 * Pure on purpose, in the same way and for the same reason as `staff.ts`: the
 * auth config that calls these cannot be unit tested without a database, and
 * these can. Nothing here reads the environment or touches a request.
 */

/* -------------------------------------------------------------------------
 * Apple's client secret
 * ---------------------------------------------------------------------- */

/**
 * How long a minted Apple client secret is good for.
 *
 * Apple caps this at six months and rejects anything longer, but six months is
 * the *ceiling*, not the target. The secret is minted fresh every time this
 * module is evaluated — every cold start, every deploy — so the only thing a
 * long life buys is a longer window in which a leaked secret still works.
 * Thirty days is far beyond the lifetime of any serverless instance while
 * staying comfortably inside Apple's limit.
 *
 * This is why there is no `APPLE_CLIENT_SECRET` variable and no rotation
 * reminder in anyone's calendar: the thing that expires is derived, not
 * stored. What is stored is the `.p8` key, which does not expire at all.
 * See `docs/auth/apple-sign-in.md`.
 */
export const APPLE_CLIENT_SECRET_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Apple's token endpoint is the only audience a client secret may name. */
const APPLE_AUDIENCE = "https://appleid.apple.com";

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

/**
 * A `.p8` key as `crypto` wants it.
 *
 * Vercel, and every other platform that stores environment variables as single
 * lines, gives back the two-character sequence `\n` where the PEM had a real
 * newline. OpenSSL rejects that, and the error it gives is about the key being
 * unreadable rather than about the newlines — so both forms are accepted here
 * and normalised to the one form that parses.
 */
function pem(privateKey: string): string {
  return privateKey.includes("\\n")
    ? privateKey.replace(/\\n/g, "\n").trim()
    : privateKey.trim();
}

/**
 * Apple's "client secret", which Apple does not issue.
 *
 * Every other provider hands you a secret string and you paste it into an
 * environment variable. Apple instead gives you an ES256 signing key and
 * expects the secret to be a JWT you sign with it — which is why this exists
 * at all, and why `APPLE_PRIVATE_KEY`, `APPLE_TEAM_ID` and `APPLE_KEY_ID` are
 * configured rather than a secret.
 *
 * Minting it here rather than by hand removes the failure this integration is
 * most famous for: a pasted secret silently reaching its six-month expiry, and
 * Sign in with Apple returning `invalid_client` one morning for no reason
 * anyone can see in the code or the deploy log.
 *
 * `now` is a parameter so the result is a pure function of its inputs and a
 * test can assert the claims rather than assert around a clock.
 */
export function appleClientSecret(opts: {
  /** The Services ID — the `sub` claim, and the client Apple authenticates. */
  clientId: string;
  teamId: string;
  keyId: string;
  /** The `.p8` contents, with real or escaped newlines. */
  privateKey: string;
  /** Milliseconds since the epoch, as `Date.now()` gives them. */
  now: number;
  ttlSeconds?: number;
}): string {
  const issuedAt = Math.floor(opts.now / 1000);
  const header = { alg: "ES256", kid: opts.keyId, typ: "JWT" };
  const payload = {
    iss: opts.teamId,
    iat: issuedAt,
    exp: issuedAt + (opts.ttlSeconds ?? APPLE_CLIENT_SECRET_TTL_SECONDS),
    aud: APPLE_AUDIENCE,
    sub: opts.clientId,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;

  /*
   * `ieee-p1363` is not optional. Node signs ECDSA as DER by default, and a
   * DER signature in a JWS is well-formed nonsense — Apple answers
   * `invalid_client`, exactly as it would for an expired or mistyped secret,
   * so the wrong encoding is indistinguishable from every other failure here.
   */
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({ key: pem(opts.privateKey), dsaEncoding: "ieee-p1363" });

  return `${signingInput}.${base64url(signature)}`;
}

/* -------------------------------------------------------------------------
 * Apple's name, which arrives once or never
 * ---------------------------------------------------------------------- */

/**
 * What to call a seller Apple told us nothing about.
 *
 * Deliberately not an empty string: `user.name` is `notNull`, and a blank name
 * renders as "Hi ," in every transactional email. Deliberately not a failure
 * either — refusing the sign-up over a missing display name would be a worse
 * answer than a placeholder the seller can change in Settings → Account.
 */
const UNNAMED_SELLER = "Seller";

/** `true`, `"true"`, and anything else Apple's identity token might carry. */
const isTrue = (value: unknown): boolean => value === true || value === "true";

/**
 * The name to persist from an Apple sign-in.
 *
 * **Apple sends the name exactly once — on the very first authorisation, and
 * never again.** Not on the second sign-in, not after the seller revokes and
 * re-grants access, not if the row is lost. So the one callback that carries
 * it is the only chance to store it, and every later callback has to be
 * satisfied with what is already there.
 *
 * The fallbacks, in order:
 *
 * 1. What Apple sent, when it sent it.
 * 2. The local part of the address — a reasonable stand-in for a real address
 *    the seller chose.
 * 3. A placeholder, for a Hide My Email relay address, whose local part is a
 *    random hex string: "Hi 3f9a2c1b7e" reads worse than "Hi Seller", and
 *    unlike a real local part it says nothing true about anyone.
 */
export function appleDisplayName(profile: {
  name?: unknown;
  email?: unknown;
  is_private_email?: unknown;
}): string {
  const given = typeof profile.name === "string" ? profile.name.trim() : "";
  if (given) return given;

  const email = typeof profile.email === "string" ? profile.email : "";
  const local = email.split("@")[0]?.trim() ?? "";
  if (local && !isTrue(profile.is_private_email)) return local;

  return UNNAMED_SELLER;
}

/* -------------------------------------------------------------------------
 * The endpoints that mint a session from a provider
 * ---------------------------------------------------------------------- */

/**
 * The two better-auth endpoints that can end with a signed-in seller who never
 * typed a password.
 *
 * `/callback/:id` is the browser flow's return leg — a redirect, which is why
 * the hook that guards it answers with a redirect of its own. `/sign-in/social`
 * is the native flow: the app hands over an identity token it got from the
 * device and gets JSON back, with no browser involved at any point.
 *
 * `/callback/:id` is the *route pattern*, which is what better-auth puts in
 * `ctx.path` — matching on `/callback/google` would never fire. Rate-limit
 * rules are the exception and are keyed on the real request path, so they use
 * a wildcard instead.
 *
 * Both are named here rather than inline because two separate guards in
 * `auth.ts` — the two-factor challenge and the staff refusal — have to cover
 * exactly the same set, and a set that drifts apart is a hole in whichever one
 * forgot an entry.
 */
export const SOCIAL_SESSION_PATHS = new Set(["/callback/:id", "/sign-in/social"]);

export function isSocialSessionPath(path: string): boolean {
  return SOCIAL_SESSION_PATHS.has(path);
}

/** Whether a social response should be JSON rather than a redirect. */
export function socialPathAnswersJson(path: string): boolean {
  return path === "/sign-in/social";
}
