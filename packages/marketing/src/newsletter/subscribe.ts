import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { marketingOptOuts, newsletterSubscribers } from "@sailo/db/schema";
import { appOrigin } from "@sailo/core/origin";
import { b64url, signingKey } from "@sailo/core/token";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@sailo/i18n/config";
import {
  DEFAULT_NEWSLETTER_SOURCE,
  isNewsletterSource,
  normalizeSourcePath,
  type NewsletterSource,
} from "./list";

/**
 * How somebody joins *Sailo's* mailing list — the blog's signup form, and the
 * only door onto it.
 *
 * The shop-side twin is `../broadcasts/subscribe`, and this is deliberately
 * the same design rather than a simpler one, because the two failure modes are
 * identical and both are severe:
 *
 * **Double opt-in, and not as ceremony.** Nothing is written when the form is
 * submitted. Anyone can type anyone's address into a public form, and a single
 * opt-in would let a stranger sign their ex-partner up to a newsletter and let
 * a bot fill this table with addresses that hard-bounce. Those bounces are
 * charged against a sending domain that also carries password resets and order
 * receipts, so a poisoned marketing list is not a marketing problem — it is
 * every seller's buyers not getting their receipts. The address becomes a row
 * only when a link sent *to that address* is clicked.
 *
 * **No enumeration surface.** The form's answer is the same sentence whether
 * the address was already subscribed, never seen, or opted out — because the
 * form does not read the database at all. A signup form that says "you're
 * already subscribed" is an address checker with a friendly face.
 *
 * What is *not* shared with the shop side is the scope. A shop's suppression
 * is per shop; leaving this list writes `marketing_opt_outs`, which is keyed
 * on the address across the whole platform, because Sailo is one sender and
 * "stop emailing me" said to us means us.
 */

/* --------------------------------------------------------------------------
   The token
-------------------------------------------------------------------------- */

/**
 * A key of this feature's own, derived rather than configured, and a *third*
 * distinct domain string.
 *
 * There are now three token families in this package — join a shop's list,
 * leave Sailo's marketing, join Sailo's list — and each is one HMAC over a
 * small JSON payload. The domain separation is the only thing stopping a token
 * minted for one from being replayed against another: without it, the link
 * that unsubscribes somebody would verify as the link that subscribes them.
 */
const DOMAIN = "sailo:newsletter:v1";

/**
 * How long a confirmation link lives.
 *
 * Unsubscribe tokens never expire, because an unsubscribe link in a two-year-
 * old email still has to work. This is the opposite case: a confirmation is a
 * live request, and a link that still works a year later is one that can be
 * dug out of a spam folder — or a forwarded mailbox — long after the person
 * stopped meaning it.
 */
export const NEWSLETTER_TOKEN_DAYS = 7;

const key = () => signingKey(DOMAIN);

export type NewsletterClaim = {
  email: string;
  /** What they typed, so the welcome can use it. Optional by design. */
  name: string | null;
  /** The language of the page they subscribed from. */
  locale: Locale;
  source: NewsletterSource;
  /** The exact page, when there was one. */
  path: string | null;
};

/** A signed, expiring token — or null when there is no secret to sign with. */
export function newsletterToken(
  claim: NewsletterClaim,
  now = new Date(),
): string | null {
  const k = key();
  if (!k) return null;

  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        e: claim.email,
        n: claim.name || undefined,
        l: claim.locale,
        s: claim.source,
        p: claim.path || undefined,
        x: Math.floor(now.getTime() / 1000) + NEWSLETTER_TOKEN_DAYS * 86_400,
      }),
      "utf8",
    ),
  );
  const sig = b64url(createHmac("sha256", k).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Reads a token back, or null if it was not one we signed, or has expired. */
export function readNewsletterToken(
  token: string,
  now = new Date(),
): NewsletterClaim | null {
  const k = key();
  if (!k) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", k).update(payload).digest());

  /*
   * Length-checked in BYTES before the compare: `timingSafeEqual` throws on a
   * byte-length mismatch, and a thrown error is itself a signal about the
   * input. 43 multi-byte characters are 43 chars and 86 bytes — the gap that
   * turned a public route's promised response into an uncaught 500 once
   * already, in this feature's two siblings.
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
    const { e, n, l, s, p, x } = parsed as Record<string, unknown>;
    if (typeof e !== "string" || !e) return null;
    if (typeof x !== "number" || x * 1000 < now.getTime()) return null;

    return {
      email: e,
      name: typeof n === "string" ? n : null,
      /*
       * Re-checked rather than trusted, even though we signed it. The claim is
       * about to choose a dictionary and set `lang` on a page; a signature
       * proves the value came from us, not that a later refactor still emits
       * a shipped locale code.
       */
      locale: typeof l === "string" && isLocale(l) ? l : DEFAULT_LOCALE,
      source: isNewsletterSource(s) ? s : DEFAULT_NEWSLETTER_SOURCE,
      path: normalizeSourcePath(p),
    };
  } catch {
    return null;
  }
}

/** The page the confirmation link opens. A GET here subscribes nobody. */
export function newsletterConfirmUrl(token: string, base = appOrigin()): string {
  return `${base}/n/${encodeURIComponent(token)}`;
}

/* --------------------------------------------------------------------------
   Confirming
-------------------------------------------------------------------------- */

export type NewsletterOutcome = "subscribed" | "refused";

/**
 * Turns a confirmed claim into a subscriber who may be mailed.
 *
 * Idempotent, because a confirmation link gets clicked twice — once by the
 * person and once by whatever scanned their mail — and the second click must
 * read as success rather than as an error in front of somebody who has just
 * done what we asked.
 *
 * A prior opt-out is lifted here and nowhere else, and only one kind of it.
 * That is the single legitimate reason to lift one: the person themselves
 * asked to come back, and proved it by clicking a link sent to their own
 * address. Without that, an unsubscribe would be a life sentence, which serves
 * nobody — least of all the person it is meant to protect.
 *
 * With one exception, matching `resumeMarketing` exactly. A `complained` row
 * came from somebody pressing "report spam" and a `bounced` one from a mail
 * server refusing the address outright. Neither is undone by a click: the
 * first is a reputational judgement we do not get to overturn on our own
 * behalf, and the second is an address that does not work. Both are refused —
 * silently to the visitor, who is told the same thing either way.
 */
export async function confirmNewsletterSubscriber(
  claim: NewsletterClaim,
  now = new Date(),
): Promise<NewsletterOutcome> {
  const db = getDb();
  const email = claim.email.toLowerCase();

  const optOut = await db.query.marketingOptOuts.findFirst({
    where: eq(marketingOptOuts.email, email),
  });
  if (optOut && optOut.reason !== "unsubscribed") return "refused";
  if (optOut) {
    await db.delete(marketingOptOuts).where(eq(marketingOptOuts.id, optOut.id));
  }

  /*
   * One statement, and the conflict target is the unique index on the address.
   *
   * The alternative — read, branch, insert or update — loses to a second click
   * arriving from the reader's phone while the first is still in flight, and
   * the loser then throws a unique-violation at somebody who has just done
   * what we asked. Postgres arbitrates instead.
   *
   * What the update does *not* touch is the point of it. `confirmedAt` and
   * `source` are the record of how this person actually joined, and a second
   * click a year later from a different article must not rewrite either — the
   * attribution question this table exists to answer is "which page won them",
   * and the answer is the first one, permanently. The name and the locale do
   * move, because those are facts about the person that can genuinely change
   * and the newer answer is the better one.
   */
  await db
    .insert(newsletterSubscribers)
    .values({
      email,
      name: claim.name,
      locale: claim.locale,
      source: claim.source,
      sourcePath: claim.path,
      confirmedAt: now,
    })
    .onConflictDoUpdate({
      target: newsletterSubscribers.email,
      set: {
        name: sql`coalesce(excluded.name, ${newsletterSubscribers.name})`,
        locale: sql`excluded.locale`,
      },
    });

  return "subscribed";
}

