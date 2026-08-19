import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { signingKey } from "./token";

/**
 * A secret a seller gave us that we have to be able to *use* again.
 *
 * The distinction from `api_keys` is the whole reason this exists. An API key
 * Sailo issues is stored as a hash, because verifying one only needs a
 * comparison — nothing ever needs the original back. An integration's key is
 * the opposite: it goes into an outbound `Authorization` header, so there is
 * no hashed form that still works, and the only honest options are plaintext
 * or reversible encryption.
 *
 * Plaintext is what `webhook_endpoints.secret` chose, and its header argues
 * the case: an HMAC secret grants nothing on its own. This is different. An
 * integration key is a live credential *on somebody else's system* — a
 * Mailchimp key, a Zapier hook, an n8n token — and a database dump containing
 * one is a breach of a service Sailo does not run and cannot revoke on the
 * seller's behalf. So it is encrypted.
 *
 * **AES-256-GCM**, keyed by a derivation of `BETTER_AUTH_SECRET` under its own
 * domain string — the same scheme every token family here uses, and the same
 * reason: a key derived per purpose means a value sealed for one thing can
 * never be opened by another. Authenticated, so a tampered ciphertext fails to
 * open rather than decrypting to rubbish that then travels in a header.
 *
 * What this is **not** is protection against somebody who has the application
 * secret as well as the database. It is not meant to be: the threat it answers
 * is a dump, a backup, a replica, a log — the places a database ends up and an
 * environment variable does not.
 */

const DOMAIN = "sailo:integration-secret:v1";

/** GCM's standard nonce length. 96 bits, never reused for a key. */
const IV_BYTES = 12;

/**
 * Seals a secret, or returns null when there is no key to seal with.
 *
 * Null is a hard stop for the caller and not something to store around: a
 * credential written in the clear because the environment was misconfigured is
 * exactly the outcome this file exists to prevent, and the write should refuse
 * instead.
 */
export function sealSecret(plaintext: string): string | null {
  const key = signingKey(DOMAIN);
  if (!key) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.subarray(0, 32), iv);
  const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // `v1.iv.tag.ciphertext`, all base64url. The version prefix is what makes a
  // future scheme change a migration rather than a guess about what a stored
  // string is.
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    sealed.toString("base64url"),
  ].join(".");
}

/**
 * Opens a sealed secret, or returns null.
 *
 * Every failure is null and none of them throw: a tampered value, a rotated
 * key, a row written by a scheme this build does not know. The caller is a
 * cron tick with a scenario to run, and the right response to "this credential
 * cannot be read" is to fail that one action visibly — never to take down a
 * tick, and never to post without the header the seller thinks is on it.
 */
export function openSecret(sealed: string): string | null {
  const key = signingKey(DOMAIN);
  if (!key) return null;

  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;

  try {
    const iv = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    const body = Buffer.from(parts[3]!, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;

    const decipher = createDecipheriv("aes-256-gcm", key.subarray(0, 32), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // `final()` throws on a bad tag, which is the authenticated part doing its
    // job. Nothing about the failure is reported upward — a caller that knew
    // *why* a credential would not open could use this as an oracle.
    return null;
  }
}

/**
 * The last four characters, for the settings card.
 *
 * Not a secret, and it is what makes a "replace" flow usable: a seller with
 * three keys needs to know which one is in this row, and four characters
 * answers that without the value ever reaching a page, a browser cache, a
 * screenshot or a support ticket.
 */
export function secretHint(plaintext: string): string {
  return plaintext.length <= 4 ? "••••" : `••••${plaintext.slice(-4)}`;
}
