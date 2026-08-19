import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appOrigin } from "@sailo/core/origin";
import { b64url, signingKey } from "@sailo/core/token";

/**
 * The link that asks a buyer whether their parcel arrived.
 *
 * Spec 44's cheapest and strongest piece of evidence. On
 * `product_not_received` — Visa 13.1, Mastercard 4855 — the whole case turns on
 * delivery, and `docs/chargebacks.md` states the rule: *"a tracking number
 * showing 'in transit' is not delivery."* A seller's own tick is weak. A
 * carrier's proof of delivery is strong and needs an integration nobody has
 * built. **The cardholder's own timestamped confirmation is stronger than
 * either**, and it costs one route.
 *
 * ## Why a signed token rather than a row
 *
 * The same reasoning `unsubscribe.ts` gives, and for the same situation: this
 * link goes in the shipping email and is clicked from a cold mail client with no
 * session and no cookie, possibly weeks later. So it carries its own proof —
 * the order id and an HMAC over it — and needs no row written at send time, no
 * lookup to resolve, and nothing that can be tidied away before it is used.
 *
 * A physical order has no `downloadToken`, which is why this cannot simply reuse
 * the digital one: `newDownloadToken()` is issued for files, tickets and
 * memberships, and a parcel is none of those.
 *
 * ## What it is not
 *
 * It is not authentication. Anybody holding the link can confirm the parcel
 * arrived, which is deliberate — the buyer forwards it to whoever was in when it
 * came — and it is why the route can do exactly one thing and that thing is
 * append-only. There is nothing here to steal and nothing to undo.
 */

/**
 * This token family's own key, derived from `BETTER_AUTH_SECRET`.
 *
 * Distinct from the unsubscribe domain so a token minted here can never be
 * presented as one of those, or forged from one. Deriving rather than adding a
 * variable is what stops a deploy where the feature silently cannot work.
 */
const DOMAIN = "sailo:arrival:v1";

const key = () => signingKey(DOMAIN);

/**
 * A signed confirmation token, or null when there is no secret to sign with.
 *
 * Null is not an error for the caller to route around. A shipping email simply
 * goes without the question — the seller's own tick still works, and a link that
 * does not verify is worse than no link, because a buyer who clicks it and is
 * refused concludes their order is wrong.
 */
export function arrivalToken(orderId: string): string | null {
  const k = key();
  if (!k) return null;

  const payload = b64url(Buffer.from(JSON.stringify({ o: orderId }), "utf8"));
  const sig = b64url(createHmac("sha256", k).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Reads a token back, or null if it was not one we signed. */
export function readArrivalToken(token: string): string | null {
  const k = key();
  if (!k) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", k).update(payload).digest());

  /*
   * Byte length before the compare, because `timingSafeEqual` throws on a
   * mismatch and a thrown error is itself a signal about the input. The same
   * trap `unsubscribe.ts` documents: 43 multi-byte characters are 43 *chars* and
   * 86 *bytes*, which a string-length check waves straight through and turns a
   * public route's promised answer into a 500.
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
    const { o } = parsed as { o?: unknown };
    return typeof o === "string" && o ? o : null;
  } catch {
    return null;
  }
}

/** The full URL to put in a shipping email. Null when there is no token. */
export function arrivalUrl(orderId: string, base?: string): string | null {
  const token = arrivalToken(orderId);
  if (!token) return null;
  return `${base || appOrigin()}/arrived/${token}`;
}
