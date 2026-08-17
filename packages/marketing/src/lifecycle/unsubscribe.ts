import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appOrigin } from "@sailo/core/origin";

/**
 * The link out of Sailo's own marketing mail.
 *
 * Same shape as `lib/broadcasts/unsubscribe.ts` — a payload and an HMAC over
 * it, so the link opens from a cold mail client with no session, no cookie
 * and no row to look up — but a *different* signing domain and a different
 * claim, and both differences matter.
 *
 * The claim is an address and nothing else. A broadcast token names a shop
 * because the promise it carries is "this shop will stop writing to you"; this
 * one names only the person, because the promise is "Sailo will stop writing
 * to you", and the seller it is sent to may not own a shop at all — the first
 * three emails in the ladder exist precisely for the people who have not built
 * one yet.
 *
 * The domain is separate so the two can never be confused. Feeding a broadcast
 * token to this reader, or the reverse, fails the signature check rather than
 * quietly unsubscribing somebody from the wrong list.
 */

/**
 * A key of this feature's own, derived rather than configured — the same trade
 * the broadcast tokens make. `BETTER_AUTH_SECRET` already exists in every
 * environment, and a new required variable would mean a deploy where marketing
 * mail silently cannot be sent. It is never used directly: the HMAC is keyed
 * by the derived value, so a token from here cannot be forged from anything
 * the auth library signs with the same secret.
 */
const DOMAIN = "sailo:marketing-optout:v1";

function key(): Buffer | null {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(DOMAIN).digest();
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export type MarketingClaim = {
  email: string;
};

/**
 * A signed token, or null when there is no secret to sign with.
 *
 * Null is a hard stop, not something for the caller to work around. Marketing
 * mail without a working unsubscribe link must not be sent at all — that is
 * the one requirement with no exception in every jurisdiction this operates in
 * — so the send pass refuses the whole tick rather than mailing anyone a dead
 * link in the footer.
 */
export function marketingOptOutToken(claim: MarketingClaim): string | null {
  const k = key();
  if (!k) return null;

  const payload = b64url(
    Buffer.from(JSON.stringify({ e: claim.email }), "utf8"),
  );
  const sig = b64url(createHmac("sha256", k).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Reads a token back, or null if it was not one we signed. */
export function readMarketingOptOutToken(token: string): MarketingClaim | null {
  const k = key();
  if (!k) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", k).update(payload).digest());

  /*
   * Length-checked in BYTES before the compare. `timingSafeEqual` throws on a
   * byte-length mismatch and a thrown error is itself a signal about the
   * input — and comparing string lengths is not the same check, because
   * `expected` is ASCII base64url while `presented` is whatever the URL
   * carried: 43 multi-byte characters are 43 chars and 86 bytes. That exact
   * gap once turned the broadcast route's promised 204 into an uncaught 500.
   */
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  if (presentedBytes.length !== expectedBytes.length) return null;
  if (!timingSafeEqual(presentedBytes, expectedBytes)) return null;

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const { e } = parsed as { e?: unknown };
    if (typeof e !== "string" || !e) return null;
    return { email: e };
  } catch {
    return null;
  }
}

/**
 * The page the link in the body opens.
 *
 * A page and not an action, because a GET must not unsubscribe anybody. Mail
 * scanners, link checkers and corporate security gateways prefetch every URL
 * in a message; a GET that wrote the opt-out row would remove people who never
 * opened the email, and nothing would distinguish that from a real click. So
 * this shows a button, and the button is a POST.
 */
export function marketingOptOutUrl(token: string, base = appOrigin()): string {
  return `${base}/u/marketing/${encodeURIComponent(token)}`;
}

/**
 * The URI in the `List-Unsubscribe` header, which RFC 8058 requires to accept
 * a POST — that is what makes Gmail's own one-click button work.
 *
 * Separate from the page above because a route handler can take a POST and a
 * page cannot. Its GET redirects to the page, so a client that follows the
 * header with a GET still reaches something a human can use, and still
 * unsubscribes nobody by fetching it.
 */
export function marketingOptOutPostUrl(token: string, base = appOrigin()): string {
  return `${base}/api/unsubscribe/marketing/${encodeURIComponent(token)}`;
}
