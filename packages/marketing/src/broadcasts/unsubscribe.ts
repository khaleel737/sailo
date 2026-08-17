import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appOrigin } from "@sailo/core/origin";
import { b64url, signingKey } from "@sailo/core/token";

/**
 * The link that has to work.
 *
 * Every marketing email carries one, and it has to open from a cold mail
 * client with no session, no cookie and no account — the person clicking it
 * may not remember buying anything. So the link carries its own proof: a
 * payload naming the shop and the address, and an HMAC over it. No database
 * lookup to resolve, no row to create when the email is sent, nothing to
 * expire, and clicking it twice does the same thing as clicking it once.
 *
 * The alternative — a random token stored per delivery — needs a row written
 * before the send and a lookup on click, and it breaks in the one case that
 * matters most: an email from eight months ago, after the delivery rows have
 * been tidied away. An unsubscribe link that has stopped working is not a
 * broken feature, it is a compliance failure and a spam complaint.
 */

/**
 * A key of this feature's own, derived rather than configured.
 *
 * `BETTER_AUTH_SECRET` already exists in every environment, and adding a
 * required variable would mean a deploy where broadcasts silently cannot be
 * sent. It is never used directly: the HMAC below is keyed by a *derived*
 * value, so a token from here can never be confused with, or forged from,
 * anything the auth library signs with the same secret.
 */
const DOMAIN = "sailo:unsubscribe:v1";

/* The derivation and the encoding are `@sailo/core/token`. `DOMAIN` above stays
   local and distinct: it is what stops a token minted here being presented as
   one of the other two families. */
const key = () => signingKey(DOMAIN);

export type UnsubscribeClaim = {
  shopId: string;
  email: string;
};

/**
 * A signed token, or null when there is no secret to sign with.
 *
 * Null is a hard stop for the caller, not something to work around. A
 * broadcast without a working unsubscribe link must not be sent at all — in
 * every jurisdiction this feature operates in that is the one requirement
 * with no exception — so `sendBroadcast` refuses rather than sending mail
 * with a dead link in the footer.
 */
export function unsubscribeToken(claim: UnsubscribeClaim): string | null {
  const k = key();
  if (!k) return null;

  const payload = b64url(
    Buffer.from(JSON.stringify({ s: claim.shopId, e: claim.email }), "utf8"),
  );
  const sig = b64url(createHmac("sha256", k).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Reads a token back, or null if it was not one we signed. */
export function readUnsubscribeToken(token: string): UnsubscribeClaim | null {
  const k = key();
  if (!k) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", k).update(payload).digest());

  /*
   * Length-checked in BYTES before the compare, because `timingSafeEqual`
   * throws on a byte-length mismatch and a thrown error is itself a signal
   * about the input. Checking `.length` on the *strings* was not enough:
   * `expected` is ASCII base64url, but `presented` is whatever the URL
   * carried, and 43 multi-byte characters are 43 chars yet 86 bytes — the
   * exact case the old check waved through, turning a public route's
   * promised 204 into an uncaught 500.
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
    const { s, e } = parsed as { s?: unknown; e?: unknown };
    if (typeof s !== "string" || typeof e !== "string" || !s || !e) return null;
    return { shopId: s, email: e };
  } catch {
    return null;
  }
}

/**
 * The page a person lands on when they click the link in the body.
 *
 * A page and not an action, because a GET must not unsubscribe anybody. Mail
 * scanners, link checkers and corporate security gateways prefetch every URL
 * in a message; a GET that suppressed an address would unsubscribe people who
 * never opened the email, and there would be no way to tell that from a real
 * click. So this shows a button, and the button is a POST.
 */
export function unsubscribeUrl(token: string, base = appOrigin()): string {
  return `${base}/u/${encodeURIComponent(token)}`;
}

/**
 * The URI in the `List-Unsubscribe` header, which RFC 8058 requires to accept
 * a POST — that is what makes Gmail's own one-click button work.
 *
 * Separate from the page above because a route handler can take a POST and a
 * page cannot. Its GET redirects to the page, so a client that follows the
 * header with a GET still reaches something a human can use, and still does
 * not unsubscribe anyone by fetching it.
 */
export function unsubscribePostUrl(token: string, base = appOrigin()): string {
  return `${base}/api/unsubscribe/${encodeURIComponent(token)}`;
}
