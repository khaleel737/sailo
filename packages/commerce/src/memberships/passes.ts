import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  memberCheckins,
  orders,
  products,
  subscriptions,
  clients,
  type Subscription,
} from "@sailo/db/schema";
import { foldScanCode } from "../ticketing/tickets";
import { membershipAccess, type MembershipAccess } from "./memberships";

/**
 * What a member shows at the door, and what happens when it is scanned.
 *
 * A membership has always been able to answer "did they pay" — that is
 * `subscriptions` — and, for a file, "may they download this right now" — that
 * is `membershipAccess` behind the download route. What it could never answer
 * is the question a gym, a class studio or a co-working desk asks forty times
 * a morning: *this person is standing here, may they come in?*
 *
 * The credential for that is not a ticket, and the difference is the whole
 * design. A ticket is one admission: it moves `valid → used` under a
 * conditional UPDATE and the second scan is refused, which is exactly right
 * for a door somebody passes through once. A member passes through it ninety
 * times a year, so the pass never burns — every scan re-asks the subscription
 * whether it is still open, and the answer is allowed to change between
 * Tuesday and Wednesday because that is what a lapsed membership *is*.
 *
 * Everything else is reused rather than rebuilt: the staff credential
 * (`door_passes`), the scanner, the guest list, the undo button and the
 * offline replay are all the ticketing ones, and none of them needed to learn
 * what a membership is.
 */

/**
 * Crockford's base32, as tickets use — no I, L, O or U, so a code read aloud
 * at a door or typed off a phone photo cannot be misheard.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Twelve characters in three groups, where a ticket is ten in two.
 *
 * The grouping is cosmetic; the *length* is load-bearing. Both codes are
 * scanned at the same doors and the door resolves a ticket first, so a member
 * pass that could also be a valid ticket code would admit the wrong person on
 * a collision. At ten characters against ten the chance is negligible but not
 * zero, and "negligible" is a poor thing to tell a seller whose gym let a
 * stranger in. At twelve against ten it is not negligible, it is *impossible*:
 * after folding, the two are different lengths and cannot be the same string.
 *
 * Sixty bits of entropy, against an endpoint that already requires either the
 * seller's session or a door-pass token.
 */
export function newMemberPassCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let code = "";
  for (const b of bytes) code += ALPHABET[b % 32];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

/**
 * However it was typed: lowercase, spaces, missing dashes, the four lookalikes
 * folded back. Shares the fold with tickets so a member and an attendee who
 * mistype the same character get the same forgiveness.
 */
export function normalizeMemberPassCode(raw: string): string {
  const cleaned = foldScanCode(raw);
  return cleaned.length === 12
    ? `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8)}`
    : cleaned;
}

/**
 * The member's code, minted on demand.
 *
 * Not at signup. Most memberships sold here deliver a file or a Discord invite
 * and will never be scanned, and issuing every one of them a door credential
 * means holding thousands of live codes for doors that do not exist. The first
 * time anybody asks — the member opening their pass, or the seller printing a
 * list — is early enough.
 *
 * The `is null` in the WHERE is the idempotency: two tabs, or a member and
 * their seller asking at the same moment, produce one code between them rather
 * than one each, and the loser reads back the winner's. Without it the second
 * write would silently re-issue and invalidate a pass already in a wallet.
 */
export async function ensureMemberPass(
  subscriptionId: string,
  shopId: string,
): Promise<string | null> {
  const db = getDb();

  const existing = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, subscriptionId),
      eq(subscriptions.shopId, shopId),
    ),
    columns: { id: true, passCode: true },
  });
  if (!existing) return null;
  if (existing.passCode) return existing.passCode;

  const code = newMemberPassCode();
  const [claimed] = await db
    .update(subscriptions)
    .set({ passCode: code, updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.id, subscriptionId),
        eq(subscriptions.shopId, shopId),
        sql`${subscriptions.passCode} is null`,
      ),
    )
    .returning({ passCode: subscriptions.passCode });

  if (claimed?.passCode) return claimed.passCode;

  // Somebody else minted between the read and the claim. Theirs is the one in
  // the member's wallet now.
  const settled = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
    columns: { passCode: true },
  });
  return settled?.passCode ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Admitting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How long a re-scan counts as the same arrival.
 *
 * Somebody scans, the screen is slow, they scan again. That is one visit, and
 * writing two would quietly inflate every attendance number a seller looks at.
 * Ten minutes is long enough to cover a queue and a retry and short enough
 * that a member who genuinely leaves and comes back at lunchtime is counted
 * twice, which they should be.
 */
export const RESCAN_WINDOW_MINUTES = 10;

export type AdmittedMember = {
  subscriptionId: string;
  code: string;
  /** The member's name, or null when the subscription has no client row. */
  memberName: string | null;
  productTitle: string | null;
  /** The subscription's own status — `active`, `past_due`, `canceled`… */
  subscriptionStatus: string;
  /** Paid up to here. What a door screen shows under the green tick. */
  until: Date | null;
  /** They asked to stop and the period has not run out yet. */
  endingSoon: boolean;
  /** When they were last admitted before this scan. Null on a first visit. */
  lastVisitAt: Date | null;
  /** Admissions ever, including this one. */
  visitCount: number;
};

/**
 * What the door learned.
 *
 * `already_in` is deliberately *not* a refusal, which is where this differs
 * most from a ticket. A ticket scanned twice is a red screen because somebody
 * is trying to get two people in on one admission. A member scanned twice is
 * an ordinary Tuesday — they queued, the screen lagged, they scanned again —
 * and showing red would have a doorperson turn away a paid-up member. It
 * carries the same payload as `checked_in`; only the wording differs.
 */
export type MemberCheckInState =
  | ({ status: "checked_in" | "already_in" } & AdmittedMember)
  /** A real pass, but for a different membership than this door works. */
  | { status: "wrong_membership"; code: string; productTitle: string | null }
  /** Found them, and they may not come in. `access` says until when. */
  | ({ status: "not_open"; access: MembershipAccess; awaitingPayment: boolean } & Omit<
      AdmittedMember,
      "lastVisitAt" | "visitCount" | "endingSoon"
    >)
  | { status: "not_found"; code: string };

export type MemberCheckInOptions = {
  /** Scope the door to one membership; anything else is `wrong_membership`. */
  productId?: string | null;
  /** The door pass that scanned, recorded on the row. Null is the owner. */
  by?: string | null;
  now?: Date;
};

/**
 * Admit a member by their pass code.
 *
 * Reads the subscription live rather than trusting anything minted earlier —
 * the same rule the download gate follows, and for the same reason: the pass
 * is in a wallet forever, so entitlement has to be decided when it is
 * presented and never when it was issued. A member who cancelled in March
 * cannot walk in in September on a code from February.
 */
export async function checkInMemberByCode(
  shopId: string,
  rawCode: string,
  opts: MemberCheckInOptions = {},
): Promise<MemberCheckInState> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const code = normalizeMemberPassCode(rawCode);
  if (!code) return { status: "not_found", code };

  const row = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.passCode, code), eq(subscriptions.shopId, shopId)),
  });
  if (!row) return { status: "not_found", code };

  const [product, client] = await Promise.all([
    row.productId
      ? db.query.products.findFirst({
          where: eq(products.id, row.productId),
          columns: { title: true },
        })
      : null,
    row.clientId
      ? db.query.clients.findFirst({
          where: eq(clients.id, row.clientId),
          columns: { name: true },
        })
      : null,
  ]);
  const productTitle = product?.title ?? null;

  /*
   * Door scoping, before entitlement. A volunteer working the yoga room is
   * told this is a swim membership rather than that it has lapsed — the
   * second would be a guess, and on a shop running four rooms it would be
   * wrong three times out of four.
   */
  if (opts.productId && row.productId !== opts.productId) {
    return { status: "wrong_membership", code, productTitle };
  }

  const access = membershipAccess(row, now);
  const memberName = client?.name ?? null;

  if (!access.open) {
    return {
      status: "not_open",
      code,
      subscriptionId: row.id,
      memberName,
      productTitle,
      subscriptionStatus: row.status,
      until: access.until,
      access,
      awaitingPayment: await hasUnpaidRenewal(row),
    };
  }

  /*
   * The last visit, read before the write, and the re-scan window decided
   * from it in memory rather than in a second WHERE. One row fetched by key
   * off the index that leads with `subscription_id` — asking twice, once
   * bounded and once not, would be two round trips to learn one thing.
   */
  const last = await db.query.memberCheckins.findFirst({
    where: eq(memberCheckins.subscriptionId, row.id),
    orderBy: [desc(memberCheckins.createdAt)],
    columns: { createdAt: true },
  });

  const previous = last?.createdAt ?? null;
  const recent =
    previous !== null &&
    previous.getTime() > now.getTime() - RESCAN_WINDOW_MINUTES * 60_000;

  if (!recent) {
    await db.insert(memberCheckins).values({
      shopId,
      subscriptionId: row.id,
      productId: row.productId,
      checkedInBy: opts.by ?? null,
    });
  }

  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberCheckins)
    .where(eq(memberCheckins.subscriptionId, row.id));

  return {
    status: recent ? "already_in" : "checked_in",
    code,
    subscriptionId: row.id,
    memberName,
    productTitle,
    subscriptionStatus: row.status,
    until: access.until,
    endingSoon: access.endingSoon,
    lastVisitAt: previous,
    visitCount: counted?.n ?? 1,
  };
}

/**
 * Whether a manual member has a renewal sitting unpaid.
 *
 * Only ever true on a manual rail — a card renewal is charged rather than
 * asked for. It is the difference between "their card failed" and "we asked
 * them for March and they have not sent it yet", and a doorperson deciding
 * whether to wave somebody through deserves the second sentence rather than
 * the first.
 *
 * Asked here rather than through `accessForOrder`, which needs an order and
 * there is not one at a door — the member is presenting a pass, not a receipt.
 */
async function hasUnpaidRenewal(row: Subscription): Promise<boolean> {
  if (row.billingMode !== "manual") return false;
  const found = await getDb().query.orders.findFirst({
    where: and(
      eq(orders.subscriptionId, row.id),
      eq(orders.paymentStatus, "unpaid"),
    ),
    columns: { id: true },
  });
  return Boolean(found);
}

/* -------------------------------------------------------------------------- */
/*  Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** One member's visits, newest first — the profile panel. */
export async function memberVisits(subscriptionId: string, limit = 50) {
  return getDb().query.memberCheckins.findMany({
    where: eq(memberCheckins.subscriptionId, subscriptionId),
    orderBy: [desc(memberCheckins.createdAt)],
    limit,
  });
}

/** The shop's attendance, newest first — the door's own log. */
export async function shopCheckins(shopId: string, limit = 100) {
  return getDb().query.memberCheckins.findMany({
    where: eq(memberCheckins.shopId, shopId),
    orderBy: [desc(memberCheckins.createdAt)],
    limit,
  });
}

/**
 * Visits per member for a whole shop, in one query.
 *
 * The members list renders three hundred rows and needs a count and a last
 * date on each. Asking per row is six hundred round trips for one page — the
 * same trap the names on that screen already avoid by fetching clients and
 * products in bulk, and the reason this returns a Map rather than a list the
 * caller has to index itself.
 *
 * Grouped in Postgres rather than counted in JS: a busy gym's attendance is
 * the largest table in the shop within a year, and shipping every row to the
 * app to length-check it would be the one query that eventually takes the
 * page down.
 */
export async function visitSummary(
  shopId: string,
): Promise<Map<string, { count: number; lastAt: Date }>> {
  const rows = await getDb()
    .select({
      subscriptionId: memberCheckins.subscriptionId,
      count: sql<number>`count(*)::int`,
      lastAt: sql<Date>`max(${memberCheckins.createdAt})`,
    })
    .from(memberCheckins)
    .where(eq(memberCheckins.shopId, shopId))
    .groupBy(memberCheckins.subscriptionId);

  return new Map(
    rows.map((r) => [r.subscriptionId, { count: r.count, lastAt: r.lastAt }]),
  );
}
