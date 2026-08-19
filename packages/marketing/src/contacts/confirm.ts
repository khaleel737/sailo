import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appOrigin } from "@sailo/core/origin";
import { b64url, signingKey } from "@sailo/core/token";

/**
 * The link that turns a `pending` list member into a subscribed one.
 *
 * A fourth token family, and a fourth domain string, following the rule
 * `broadcasts/subscribe.ts` and `broadcasts/unsubscribe.ts` already set: each
 * kind of link is keyed by a derivation of its own, so a token minted to join
 * a list can never be presented as one that unsubscribes somebody, and none of
 * them can be forged from another.
 *
 * **The consent half is not reimplemented here.** Confirming a list join calls
 * `confirmSubscriber` — the existing signup path, unchanged — for the parts
 * that carry legal weight: granting `marketingConsentAt`, lifting an
 * `unsubscribed` suppression, and refusing to lift a `bounced` or `complained`
 * one. This file only carries the extra fact that path has no room for, which
 * is *which list* was being joined. A second implementation of rule 8 is how
 * rule 8 stops being true on one of the two paths.
 */

const DOMAIN = "sailo:list-confirm:v1";

/**
 * Same seven days as a signup confirmation, for the same reason: a join is a
 * live request, and a link that still works a year later is one that can be
 * dug out of a spam folder long after the person stopped meaning it.
 */
export const LIST_CONFIRM_TOKEN_DAYS = 7;

const key = () => signingKey(DOMAIN);

export type ListConfirmClaim = {
  shopId: string;
  listId: string;
  email: string;
  name: string | null;
};

/** A signed, expiring token — or null when there is no secret to sign with. */
export function listConfirmToken(
  claim: ListConfirmClaim,
  now = new Date(),
): string | null {
  const k = key();
  if (!k) return null;

  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        s: claim.shopId,
        l: claim.listId,
        e: claim.email,
        n: claim.name || undefined,
        x: Math.floor(now.getTime() / 1000) + LIST_CONFIRM_TOKEN_DAYS * 86_400,
      }),
      "utf8",
    ),
  );
  const sig = b64url(createHmac("sha256", k).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Reads a token back, or null if it was not one we signed or it has expired. */
export function readListConfirmToken(
  token: string,
  now = new Date(),
): ListConfirmClaim | null {
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
   * input — the exact bug `readUnsubscribeToken` records, where 43 multi-byte
   * characters are 43 chars and 86 bytes and turned a public route's promised
   * 204 into an uncaught 500.
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
    const { s, l, e, n, x } = parsed as Record<string, unknown>;
    if (typeof s !== "string" || !s) return null;
    if (typeof l !== "string" || !l) return null;
    if (typeof e !== "string" || !e) return null;
    if (typeof x !== "number" || x * 1000 < now.getTime()) return null;
    return { shopId: s, listId: l, email: e, name: typeof n === "string" ? n : null };
  } catch {
    return null;
  }
}

/** Where the link in the confirmation email points. */
export function listConfirmUrl(token: string, base = appOrigin()): string {
  return `${base}/lists/confirm/${encodeURIComponent(token)}`;
}
