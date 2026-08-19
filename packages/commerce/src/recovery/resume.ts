import { createHmac, timingSafeEqual } from "node:crypto";
import { appOrigin } from "@sailo/core/origin";
import { b64url, signingKey } from "@sailo/core/token";

/**
 * The link in the recovery email.
 *
 * A fifth token family and a fifth domain string, following the rule the rest
 * of this codebase already keeps: each kind of link is keyed by a derivation of
 * its own, so a token minted to resume a checkout can never be presented as one
 * that unsubscribes somebody, and none can be forged from another.
 *
 * **It restores the basket, never a price.** The token carries a session id and
 * nothing about money, and the checkout it opens re-prices everything from the
 * catalogue on arrival. That is not defensive — it is the invariant the whole
 * checkout rests on, and a resume link is exactly the shape of thing that would
 * quietly break it: a "helpful" `subtotal` in the payload would be a price
 * arriving from a browser, which is the one thing the server never takes.
 *
 * It expires with the session, for the same reason a confirmation link does: a
 * resume link that still works next spring is one that can be dug out of a
 * forwarded mailbox long after the offer inside it stopped being true.
 */

const DOMAIN = "sailo:checkout-resume:v1";

const key = () => signingKey(DOMAIN);

export type ResumeClaim = {
  sessionId: string;
  shopId: string;
};

/** A signed, expiring token — or null when there is no secret to sign with. */
export function resumeToken(
  claim: ResumeClaim,
  expiresAt: Date,
): string | null {
  const k = key();
  if (!k) return null;

  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        c: claim.sessionId,
        s: claim.shopId,
        x: Math.floor(expiresAt.getTime() / 1000),
      }),
      "utf8",
    ),
  );
  const sig = b64url(createHmac("sha256", k).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Reads a token back, or null if it was not one we signed or it has expired. */
export function readResumeToken(token: string, now = new Date()): ResumeClaim | null {
  const k = key();
  if (!k) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", k).update(payload).digest());

  /*
   * Length-checked in BYTES before the compare. `timingSafeEqual` throws on a
   * byte-length mismatch, and a thrown error is itself a signal about the
   * input — the bug `readUnsubscribeToken` records, where 43 multi-byte
   * characters are 43 chars and 86 bytes.
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
    const { c, s, x } = parsed as Record<string, unknown>;
    if (typeof c !== "string" || !c) return null;
    if (typeof s !== "string" || !s) return null;
    if (typeof x !== "number" || x * 1000 < now.getTime()) return null;
    return { sessionId: c, shopId: s };
  } catch {
    return null;
  }
}

/**
 * Where the link points.
 *
 * The shop's own storefront rather than a Sailo-branded page, because the
 * buyer is being asked to finish buying from *that shop* — landing them
 * somewhere that says Sailo is the moment they remember they were not sure.
 */
export function resumeUrl(handle: string, token: string, base = appOrigin()): string {
  return `${base}/${encodeURIComponent(handle)}?resume=${encodeURIComponent(token)}`;
}
