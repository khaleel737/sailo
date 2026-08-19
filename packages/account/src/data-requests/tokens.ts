import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { b64url, signingKey } from "@sailo/core/token";

/**
 * The link that turns a stranger's form submission into a request from a person.
 *
 * Spec 52's central rule: **verification comes first, always.** Nothing is
 * assembled and nothing is deleted until a token mailed to the address is
 * clicked. An unverified erasure request is a deletion primitive for anyone who
 * knows a buyer's email; an unverified access request is worse — it hands one
 * person another's address and order history.
 *
 * ## Its own domain, and why that is not paperwork
 *
 * `sailo:data-request:v1`, derived from `BETTER_AUTH_SECRET` under its own
 * label, exactly as unsubscribe, subscribe, marketing opt-out and arrival each
 * have theirs. The property is specific and worth stating: **no other token in
 * this system can trigger an erasure, and this one can do nothing else.** An
 * unsubscribe link that could be replayed against this route would let anyone
 * holding a newsletter footer delete a buyer's record.
 *
 * ## Signed *and* hashed
 *
 * The signature is what makes the token self-proving, so a click needs no
 * lookup by a guessable id. The hash in `data_requests.verify_token_hash` is
 * what binds it to one row: without it a valid signature over
 * `{r: <some other request id>}` would verify. The token itself is never
 * stored — a stored token is a live credential sitting in a table.
 */

const DOMAIN = "sailo:data-request:v1";

const key = () => signingKey(DOMAIN);

/** What the token carries: which request, and when it stops being valid. */
type Payload = { r: string; x: number };

/**
 * A signed verification token, or null when there is no secret to sign with.
 *
 * Null is a real configuration and the caller reports it rather than crashing.
 * A data-request form on a deployment with no `BETTER_AUTH_SECRET` cannot mail a
 * link that would ever verify, and issuing one anyway would be worse than
 * refusing: the buyer clicks, is turned away, and concludes the shop ignored
 * them.
 */
export function dataRequestToken(requestId: string, expiresAt: Date): string | null {
  const k = key();
  if (!k) return null;

  const payload: Payload = { r: requestId, x: Math.floor(expiresAt.getTime() / 1000) };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", k).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Reads a token back: the request id, or null.
 *
 * Null for a bad signature, an expired token, a malformed body, and a token
 * from another family. One answer for all of them, because the difference
 * between "forged" and "expired" is information about our signing that the
 * holder of a bad token has no business learning.
 */
export function readDataRequestToken(token: string, now = new Date()): string | null {
  const k = key();
  if (!k) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const presented = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(b64url(createHmac("sha256", k).update(body).digest()));

  /*
   * Byte length first: `timingSafeEqual` throws on a mismatch, and a thrown
   * error is itself a signal about the input. 43 multi-byte characters are 43
   * *chars* and 86 *bytes*, which a string-length check waves through — the trap
   * `unsubscribe.ts` and `arrival.ts` both document.
   */
  if (presented.length !== expected.length) return null;
  if (!timingSafeEqual(presented, expected)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const { r, x } = parsed as Partial<Payload>;
    if (typeof r !== "string" || !r) return null;
    if (typeof x !== "number" || x * 1000 <= now.getTime()) return null;
    return r;
  } catch {
    return null;
  }
}

/**
 * What goes in the row, so the token binds to one request and not to any.
 *
 * A plain SHA-256 rather than a slow KDF, and deliberately: the input is 32
 * bytes of our own entropy inside a signed envelope, not a human-chosen secret,
 * so there is nothing for a work factor to defend against and a slow hash on a
 * public verify route is a denial-of-service surface instead.
 */
export function hashDataRequestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
