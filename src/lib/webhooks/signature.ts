import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * How a seller proves a POST claiming to be from Sailo actually is.
 *
 * This implements [Standard Webhooks](https://www.standardwebhooks.com) —
 * three headers, one HMAC — rather than a scheme of our own.
 *
 * `docs/specs/16-outbound-webhooks.md` asked for Stripe's scheme "so consumers
 * can reuse verifiers", and this is that requirement met better rather than
 * ignored. Standard Webhooks has maintained verification libraries in nine
 * languages, so a consumer writes one line instead of transcribing a recipe
 * out of our documentation and getting the concatenation wrong. It is also
 * exactly what Svix speaks, which keeps the door open: if delivery volume ever
 * outgrows our own cron, moving behind Svix would be invisible to every
 * endpoint already receiving from us. Neither is true of a bespoke header.
 *
 * The one thing every scheme gets wrong if it is careless, and this does not:
 * the signature covers the **id and the timestamp as well as the body**. Over
 * the body alone, a captured POST can be replayed for ever and a delivery can
 * be passed off as a different one.
 */

/* -------------------------------------------------------------------------- */
/*  The secret                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Standard Webhooks' own convention: `whsec_` then base64.
 *
 * The prefix is not decoration. Every verification library strips exactly this
 * before base64-decoding, so a secret carrying it can be pasted straight into
 * `new Webhook(secret)` with nothing explained — and a secret *without* it
 * gets decoded anyway by those same libraries, which is why we must not invent
 * a different one. The prefix also makes the string recognisable in a leaked
 * log, the way `sk_live_` is.
 */
const SECRET_PREFIX = "whsec_";

/** 32 bytes. The HMAC is SHA-256, so more key than that buys nothing. */
const SECRET_BYTES = 32;

export function newWebhookSecret(): string {
  return SECRET_PREFIX + randomBytes(SECRET_BYTES).toString("base64");
}

/**
 * The raw key bytes behind a stored secret.
 *
 * The signing key is the *decoded* bytes, not the printable string — that is
 * the part of Standard Webhooks most hand-rolled implementations get wrong,
 * and getting it wrong produces signatures that verify against nothing on
 * earth while looking perfectly well-formed.
 *
 * Returns null rather than throwing on a malformed secret, because the caller
 * is a delivery attempt and the honest outcome there is "this endpoint cannot
 * be signed for", recorded on the row, not an exception that fails a whole
 * cron tick for the other endpoints in it.
 */
function keyBytes(secret: string): Buffer | null {
  const body = secret.startsWith(SECRET_PREFIX)
    ? secret.slice(SECRET_PREFIX.length)
    : secret;
  if (!body) return null;

  const decoded = Buffer.from(body, "base64");
  /*
   * `Buffer.from(_, "base64")` never throws — it discards what it cannot read
   * and hands back whatever was left, so a secret of pure punctuation comes
   * back as an empty buffer and would sign every message with a zero-length
   * key. Length is the only signal that the decode meant anything.
   */
  return decoded.length > 0 ? decoded : null;
}

/* -------------------------------------------------------------------------- */
/*  Signing                                                                    */
/* -------------------------------------------------------------------------- */

export type SignedHeaders = {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
};

/**
 * What gets signed: `<id>.<timestamp>.<body>`.
 *
 * Written once, here, and used by both `signWebhook` and `verifyWebhook`, so
 * the recipe cannot drift between the thing that produces a signature and the
 * thing that proves it. A test that verifies what we signed with a *different*
 * copy of the concatenation proves nothing.
 */
function signedContent(id: string, timestamp: number, body: string): string {
  return `${id}.${timestamp}.${body}`;
}

/**
 * The three headers for one delivery attempt.
 *
 * `timestamp` is seconds, not milliseconds — the spec says seconds and every
 * consumer's tolerance check is written in them, so milliseconds here would
 * put every message roughly fifty thousand years in the future and fail
 * verification everywhere at once.
 *
 * Re-signed on each attempt with a fresh timestamp, while `id` stays the
 * delivery row's. That is what lets a consumer keep a tight replay window and
 * still accept a retry twelve hours later, and still dedupe the retry against
 * the original.
 */
export function signWebhook(opts: {
  id: string;
  body: string;
  secret: string;
  now: Date;
}): SignedHeaders | null {
  const key = keyBytes(opts.secret);
  if (!key) return null;

  const timestamp = Math.floor(opts.now.getTime() / 1000);
  const signature = createHmac("sha256", key)
    .update(signedContent(opts.id, timestamp, opts.body))
    .digest("base64");

  return {
    "webhook-id": opts.id,
    "webhook-timestamp": String(timestamp),
    /*
     * `v1,` names the algorithm, and the space-delimited list in the spec is
     * how a secret being rotated sends both signatures at once. We send one:
     * rotation here mints a new secret and shows it to the seller, who updates
     * their consumer — there is no overlap window to cover, because there is
     * no automatic rotation to be caught out by.
     */
    "webhook-signature": `v1,${signature}`,
  };
}

/* -------------------------------------------------------------------------- */
/*  Verifying — for our own tests, and for anyone reading this file            */
/* -------------------------------------------------------------------------- */

/**
 * The consumer's half of the recipe.
 *
 * Nothing in the app calls this: Sailo sends webhooks, it does not receive its
 * own. It exists so the test suite can prove a signature we produced verifies
 * under the documented rules — and so the rules are written in code that runs,
 * rather than only in prose that can quietly stop being true.
 *
 * `tolerance` defaults to five minutes, which is what the spec recommends and
 * what the published libraries use.
 */
export function verifyWebhook(opts: {
  body: string;
  headers: Record<string, string | undefined>;
  secret: string;
  now: Date;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const id = opts.headers["webhook-id"];
  const rawTimestamp = opts.headers["webhook-timestamp"];
  const presented = opts.headers["webhook-signature"];
  if (!id || !rawTimestamp || !presented) {
    return { ok: false, reason: "missing signature headers" };
  }

  const timestamp = Number(rawTimestamp);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "timestamp is not a number" };
  }

  const tolerance = opts.toleranceSeconds ?? 300;
  const drift = Math.abs(Math.floor(opts.now.getTime() / 1000) - timestamp);
  if (drift > tolerance) return { ok: false, reason: "timestamp outside tolerance" };

  const key = keyBytes(opts.secret);
  if (!key) return { ok: false, reason: "unusable secret" };

  const expected = createHmac("sha256", key)
    .update(signedContent(id, timestamp, opts.body))
    .digest("base64");

  /*
   * Every `v1,` entry, because the spec allows a space-delimited list during a
   * rotation and a verifier that reads only the first would reject a perfectly
   * good second signature. Versions we do not know are skipped rather than
   * failed: an unknown scheme is not a forgery.
   */
  for (const part of presented.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) continue;
    if (equals(value, expected)) return { ok: true };
  }

  return { ok: false, reason: "no matching signature" };
}

/** Compares without revealing where two strings first differ. */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length — so refuse first, on values that are both ours to produce anyway.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
