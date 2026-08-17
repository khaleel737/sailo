/**
 * Unguessable strings, and the keys that sign them.
 *
 * WHY ONE MODULE
 *
 * Four places minted a token with the identical line
 * `Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2,"0")).join("")`
 * — an invoice's public URL, a buyer's download, a door pass and a partner's
 * portal. Three more derived an HMAC key from `BETTER_AUTH_SECRET` with the same
 * three lines. None of them was wrong; all of them were the same decision made
 * seven times, and a decision about entropy that exists seven times is one that
 * can be weakened in six places without the seventh noticing.
 *
 * WHAT IS DELIBERATELY *NOT* UNIFIED
 *
 * The byte counts. A door pass is 24 bytes because it is a bearer credential a
 * volunteer holds on a phone; a ticket code is ten bytes of a 32-symbol alphabet
 * because somebody reads it aloud at a door. Those are different requirements and
 * each caller states its own. What is shared is the encoding, not the strength.
 *
 * The signing *domains* likewise. Each token family separates itself with its own
 * label — `sailo:unsubscribe:v1`, `sailo:subscribe:v1`,
 * `sailo:marketing-optout:v1` — precisely so a token minted for one purpose
 * cannot be presented as another. Collapsing those would be the opposite of
 * what this module is for.
 */

import { createHmac } from "node:crypto";

/**
 * `bytes` random bytes, lowercase hex.
 *
 * Hex rather than base64url because these appear in URL paths that get pasted
 * into chat apps, read off screens and typed by hand. Base64url is shorter and
 * its `-` and `_` are the two characters that get mangled by a link detector or
 * a well-meaning autocorrect.
 *
 * `crypto.getRandomValues` rather than `randomBytes` so this module runs
 * unchanged on a server, in a browser and in the phone's Hermes bundle — the Web
 * Crypto API is the one spelling all three have.
 */
export function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A signing key for one purpose, derived from the shared secret.
 *
 * `BETTER_AUTH_SECRET` is never used to sign anything directly. Every family of
 * tokens keys its HMAC by a value *derived* from it under a domain label, so a
 * token from one family can neither be confused with, nor forged from, anything
 * the auth library — or another family — signs with the same secret.
 *
 * Null when the secret is absent, which is a real configuration: a deployment
 * without it cannot mint or verify these tokens, and the callers report that
 * rather than crashing. `null` is deliberately not an empty key; signing with a
 * constant would produce forgeable tokens that look valid.
 */
export function signingKey(domain: string): Buffer | null {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(domain).digest();
}

/** base64url, for the token bodies these keys sign. */
export const b64url = (buf: Buffer): string => buf.toString("base64url");
