import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { automationOptOuts, automationRuns } from "@sailo/db/schema";
import { appOrigin } from "@sailo/core/origin";
import { b64url, signingKey } from "@sailo/core/token";

/**
 * "Stop this sequence", which is not "stop all your email".
 *
 * Theirs, and worth copying exactly: an unsubscribe from an automation email
 * stops **that automation** for ever — even if the contact later re-enters —
 * and removes them from no list. A global `email_suppressions` row still
 * outranks it and always will.
 *
 * The reason it is not a list mutation is that the two are different facts.
 * Leaving a list is a grouping changing; this is a person saying "not this
 * sequence". Conflating them would let one click silently shrink an audience
 * the seller curated by hand, and nothing would say why.
 *
 * **Its own domain string**, like every other token family in this codebase.
 * A token minted to leave one automation must not be replayable as a global
 * unsubscribe, and a broadcast's token must not cancel a flow. The derivation
 * is shared (`@sailo/core/token`); the domain is what keeps the families
 * apart.
 */

const DOMAIN = "sailo:automation-unsubscribe:v1";

const key = () => signingKey(DOMAIN);

export type AutomationUnsubClaim = {
  automationId: string;
  email: string;
};

/**
 * A signed token, or null when there is no secret to sign with.
 *
 * Null is a hard stop for the caller. An automation email without a working
 * unsubscribe link must not be sent at all — the same rule `sendBroadcast`
 * already enforces, and the one requirement with no exception in any
 * jurisdiction this product operates in.
 *
 * Deliberately no expiry. An unsubscribe link in a two-year-old email still
 * has to work, which is the same reasoning `broadcasts/unsubscribe.ts` gives
 * for not storing a per-delivery token: a link that has stopped working is not
 * a broken feature, it is a spam complaint.
 */
export function automationUnsubToken(claim: AutomationUnsubClaim): string | null {
  const k = key();
  if (!k) return null;

  const payload = b64url(
    Buffer.from(JSON.stringify({ a: claim.automationId, e: claim.email }), "utf8"),
  );
  const sig = b64url(createHmac("sha256", k).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Reads a token back, or null if it was not one we signed. */
export function readAutomationUnsubToken(token: string): AutomationUnsubClaim | null {
  const k = key();
  if (!k) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", k).update(payload).digest());

  /*
   * Length-checked in BYTES before the compare — `timingSafeEqual` throws on a
   * byte-length mismatch, and a thrown error is itself a signal about the
   * input. The bug `readUnsubscribeToken` records is 43 multi-byte characters
   * being 43 chars and 86 bytes, turning a public route's promised 204 into an
   * uncaught 500.
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
    const { a, e } = parsed as { a?: unknown; e?: unknown };
    if (typeof a !== "string" || typeof e !== "string" || !a || !e) return null;
    return { automationId: a, email: e };
  } catch {
    return null;
  }
}

/** The page the footer link opens. A page, because a GET must unsubscribe nobody. */
export function automationUnsubUrl(token: string, base = appOrigin()): string {
  return `${base}/u/flow/${encodeURIComponent(token)}`;
}

/**
 * The URI in the `List-Unsubscribe` header, which RFC 8058 requires to take a
 * POST — that is what makes Gmail's own one-click button work.
 */
export function automationUnsubPostUrl(token: string, base = appOrigin()): string {
  return `${base}/api/unsubscribe/flow/${encodeURIComponent(token)}`;
}

/**
 * Records the opt-out and stops any run this person is on.
 *
 * Both, and in that order. The row is what makes the decision stick through a
 * later re-entry; cancelling the live run is what stops the next email, which
 * is the thing the person clicking actually wanted. Doing only the first would
 * leave a sequence mid-flight that the opt-out silently skips step by step —
 * technically correct and indistinguishable, to the recipient, from not
 * working.
 *
 * Idempotent: the second click is a no-op rather than an error, in front of
 * somebody already annoyed enough to be clicking twice.
 */
export async function optOutOfAutomation(claim: AutomationUnsubClaim): Promise<void> {
  const db = getDb();
  const email = claim.email.toLowerCase();

  await db
    .insert(automationOptOuts)
    .values({ automationId: claim.automationId, email })
    .onConflictDoNothing();

  await db
    .update(automationRuns)
    .set({ status: "cancelled", wakeAt: null, finishedAt: new Date() })
    .where(
      and(
        eq(automationRuns.automationId, claim.automationId),
        eq(automationRuns.email, email),
        /*
         * Only the live states. A `done` run rewritten to `cancelled` would
         * lose the record that this contact completed the sequence, and the
         * metrics screen reads exactly that difference.
         */
        eq(automationRuns.status, "waiting"),
      ),
    );

  await db
    .update(automationRuns)
    .set({ status: "cancelled", wakeAt: null, finishedAt: new Date() })
    .where(
      and(
        eq(automationRuns.automationId, claim.automationId),
        eq(automationRuns.email, email),
        eq(automationRuns.status, "queued"),
      ),
    );
}

/** Whether this address has left this automation for good. */
export async function hasOptedOutOfAutomation(
  automationId: string,
  email: string,
): Promise<boolean> {
  const row = await getDb().query.automationOptOuts.findFirst({
    where: and(
      eq(automationOptOuts.automationId, automationId),
      eq(automationOptOuts.email, email.toLowerCase()),
    ),
    columns: { email: true },
  });
  return Boolean(row);
}
