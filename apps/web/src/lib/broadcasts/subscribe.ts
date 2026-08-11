import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, emailSuppressions } from "@sailo/db/schema";
import { appUrl } from "@/lib/app-url";
import { maybeRow } from "@/lib/invariant";

/**
 * How somebody joins a shop's mailing list without buying anything first.
 *
 * Until this existed, the only way onto a seller's list was a tick-box at
 * checkout — so a list could never grow faster than sales, and the visitor
 * who liked the shop but was not ready to buy had no way to say "tell me when
 * there's something new". That is the audience a broadcast is *for*.
 *
 * **Double opt-in, and not as ceremony.** Nothing is written when the form is
 * submitted. Anyone can type anyone's address into a public form; a single
 * opt-in would let a stranger sign their ex-partner up to forty shops, and it
 * would let a bot fill a seller's customer list with addresses that bounce —
 * which costs the seller's sending reputation and every other seller's on the
 * shared domain. The address becomes a contact only when a link sent *to that
 * address* is clicked, which is proof the person asked.
 *
 * That also means this whole file has no enumeration surface: the form's
 * answer is the same sentence whether the address was already subscribed,
 * never seen, or suppressed, because the form does not read the database at
 * all.
 */

/* --------------------------------------------------------------------------
   The token
-------------------------------------------------------------------------- */

/**
 * A key of this feature's own, derived rather than configured — the same
 * reasoning as `./unsubscribe`, and a *different* domain string, so a token
 * that unsubscribes somebody can never be replayed as one that subscribes
 * them and vice versa.
 */
const DOMAIN = "sailo:subscribe:v1";

/**
 * How long a confirmation link lives.
 *
 * Unsubscribe tokens never expire, because an unsubscribe link in a
 * two-year-old email still has to work. This is the opposite case: a
 * confirmation is a live request, and a link that still works a year later is
 * one that can be dug out of a spam folder — or a forwarded mailbox — long
 * after the person stopped meaning it.
 */
export const SUBSCRIBE_TOKEN_DAYS = 7;

function key(): Buffer | null {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(DOMAIN).digest();
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export type SubscribeClaim = {
  shopId: string;
  email: string;
  /** What they typed, so the welcome can use their name. Optional by design. */
  name: string | null;
};

/** A signed, expiring token — or null when there is no secret to sign with. */
export function subscribeToken(
  claim: SubscribeClaim,
  now = new Date(),
): string | null {
  const k = key();
  if (!k) return null;

  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        s: claim.shopId,
        e: claim.email,
        n: claim.name || undefined,
        x: Math.floor(now.getTime() / 1000) + SUBSCRIBE_TOKEN_DAYS * 86_400,
      }),
      "utf8",
    ),
  );
  const sig = b64url(createHmac("sha256", k).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Reads a token back, or null if it was not one we signed, or has expired. */
export function readSubscribeToken(
  token: string,
  now = new Date(),
): SubscribeClaim | null {
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
   * input. 43 multi-byte characters are 43 chars and 86 bytes — the case that
   * turned a public route's promised response into an uncaught 500 once
   * already, in this feature's sibling.
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
    const { s, e, n, x } = parsed as {
      s?: unknown;
      e?: unknown;
      n?: unknown;
      x?: unknown;
    };
    if (typeof s !== "string" || typeof e !== "string" || !s || !e) return null;
    if (typeof x !== "number" || x * 1000 < now.getTime()) return null;
    return { shopId: s, email: e, name: typeof n === "string" ? n : null };
  } catch {
    return null;
  }
}

/** The page the confirmation link opens. A GET here subscribes nobody. */
export function confirmUrl(token: string, base = appUrl()): string {
  return `${base}/s/${encodeURIComponent(token)}`;
}

/** Where a seller sends people. Works whether or not the card is switched on. */
export function subscribePageUrl(handle: string, base = appUrl()): string {
  return `${base}/${handle}/subscribe`;
}

/* --------------------------------------------------------------------------
   The address itself
-------------------------------------------------------------------------- */

/**
 * Deliberately not the RFC's grammar.
 *
 * A pattern that accepts every legal address accepts a great many that no
 * mail server will ever deliver to, and the cost of rejecting an exotic-but-
 * real address here is one person typing it again; the cost of accepting
 * junk is a hard bounce charged against the sending domain every other seller
 * shares. One `@`, something on each side, a dot in the host, no whitespace.
 */
const EMAIL_RE = /^[^\s@,;:<>"'()[\]\\]{1,64}@[^\s@.,;:<>"'()[\]\\]+(\.[^\s@.,;:<>"'()[\]\\]+)+$/;

export const MAX_EMAIL_LENGTH = 254;
export const MAX_NAME_LENGTH = 60;

/** The address, folded — or null if it is not one. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value.length < 3 || value.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_RE.test(value) ? value : null;
}

/** What they typed in the name box, if anything usable. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return value || null;
}

/* --------------------------------------------------------------------------
   Confirming
-------------------------------------------------------------------------- */

export type ConfirmOutcome = "subscribed" | "refused";

/**
 * Turns a confirmed claim into a contact who may be mailed.
 *
 * Idempotent, because a confirmation link gets clicked twice — once by the
 * person and once by whatever scanned their mail — and the second click must
 * read as success rather than as an error in front of somebody who has just
 * done what we asked.
 *
 * A prior suppression is lifted here and nowhere else. That is the single
 * legitimate reason to lift one: the person themselves asked to come back,
 * and proved it by clicking a link sent to their own address. Without it an
 * unsubscribe would be a life sentence, which serves nobody — least of all
 * the person it is supposed to protect.
 *
 * With one exception. A `complained` suppression came from somebody pressing
 * "report spam", and a `bounced` one from a mail server refusing the address
 * outright. Neither is undone by a click: the first is a reputational
 * judgement we do not get to overturn on the sender's behalf, and the second
 * is an address that does not work. Both are refused — silently to the
 * visitor, who is told the same thing either way.
 */
export async function confirmSubscriber(
  claim: SubscribeClaim,
  now = new Date(),
): Promise<ConfirmOutcome> {
  const db = getDb();
  const email = claim.email.toLowerCase();

  const suppression = await db.query.emailSuppressions.findFirst({
    where: and(
      eq(emailSuppressions.shopId, claim.shopId),
      eq(emailSuppressions.email, email),
    ),
  });
  if (suppression && suppression.reason !== "unsubscribed") return "refused";
  if (suppression) {
    await db
      .delete(emailSuppressions)
      .where(eq(emailSuppressions.id, suppression.id));
  }

  /*
   * Matched on the folded address, not on `clients.email` as stored. The
   * unique index is over the stored casing, so a checkout that wrote
   * `Ada@example.com` and a signup that folds to `ada@example.com` are the
   * same person to everybody except an equality test — and inserting a second
   * row for them would split their history and mail them twice.
   */
  const existing = await db.query.clients.findFirst({
    where: and(
      eq(clients.shopId, claim.shopId),
      sql`lower(${clients.email}) = ${email}`,
    ),
  });

  if (existing) {
    await db
      .update(clients)
      .set({
        // Grant-only, like every other consent write in this codebase: a
        // person confirming again has not withdrawn the consent they already
        // gave, so the earlier timestamp — the one an audit asks about —
        // stands.
        marketingConsentAt: existing.marketingConsentAt ?? now,
        // A name they typed here fills a gap; it never overwrites one the
        // seller or an order already knows.
        name: existing.name === ANONYMOUS ? (claim.name ?? existing.name) : existing.name,
        updatedAt: now,
      })
      .where(eq(clients.id, existing.id));
    return "subscribed";
  }

  const created = maybeRow(
    await db
      .insert(clients)
      .values({
        shopId: claim.shopId,
        name: claim.name ?? ANONYMOUS,
        email,
        phone: null,
        source: "subscribe",
        marketingConsentAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: clients.id }),
  );
  if (created) return "subscribed";

  /*
   * Lost the race with a concurrent write — two clicks on the same link, or a
   * checkout completing in another tab. Whoever won wrote the row; the
   * consent this click carries still has to land on it.
   */
  const winner = await db.query.clients.findFirst({
    where: and(
      eq(clients.shopId, claim.shopId),
      sql`lower(${clients.email}) = ${email}`,
    ),
  });
  if (!winner) return "refused";

  await db
    .update(clients)
    .set({
      marketingConsentAt: winner.marketingConsentAt ?? now,
      updatedAt: now,
    })
    .where(eq(clients.id, winner.id));
  return "subscribed";
}

/** What `upsertClient` calls a buyer who gave no name. Matched, not invented. */
const ANONYMOUS = "Anonymous";
